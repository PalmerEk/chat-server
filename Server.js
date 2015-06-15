'use strict';

const debug = require('debug')('app:server');
const io = require('socket.io');
const _ = require('lodash');
const CBuffer = require('CBuffer');
const Lib = require('./lib');
const API = require('./moneypotAPI');
const Client = require('./Client');
const db = require('./db');


/** Chat server */

module.exports = Server;
function Server(httpServer) {
    this.io = io(httpServer);

    // Map of RoomString -> Object
    this.rooms = {};

    // Map socketId to Client instance
    this.clients = {};

    // Map of Uname to UserObj
    this.users   = {};

    this.io.on('connect', this.onConnect.bind(this));

    var self = this;
}

/** Receive the socket and attach listeners */
Server.prototype.onConnect = function(socket) {
    var self = this;
    debug('[connect] new client connection:', socket.id);

    socket.on('error', function(err) {
        debug('socket error:', err);
    });

    socket.once('auth', function(data, cb) {
        self.onAuth.call(self, socket, data, cb);
    });
};

/**
 * Do client Authentication
 *
 * @param {Object} data - is { app_id: Int, hashed_token: Maybe String }
 * @param {function} cb - clients callback(err, data)
 */
Server.prototype.onAuth = function(socket, data, cb) {
    debug('socket auth:', data);
    var self = this;

    // Auth must provide object payload
    if (!_.isPlainObject(data)) {
        socket.emit('client_error', 'must send data object with `auth` event');
        return;
    }

    // Auth must provide app_id
    if (typeof data.app_id !== 'number') {
        socket.emit('client_error', 'must send app_id integer with `auth` event');
        return;
    }

    if (typeof cb !== 'function') {
        // Emit to socket since they didn't provide a callback
        socket.emit('client_error', 'must provide callback to `auth` event');
        return;
    }


    // Validation success

    API.findAppById(data.app_id, function(err, app) {

        if (err) {
            console.error('[findAppById] Error:', err, err.stack);
            cb('INTERNAL_ERROR');
            return;
        }

        // If client doesn't give us
        if (!app) {
            socket.emit('client_error', 'no app found with the app_id you sent to `auth` event');
            return;
        }

        // App found
        var room = 'app:' + app.id;

        // if hash not given, then create client without user
        if (typeof (data.hashed_token || data.token_hash) !== 'string') {
            debug('no hashed_token given');
            self.addClient(socket, new Client(self, socket, room), cb);
            return;
        }

        // data is either user object or { error: String }
        // example data: { error: 'INVALID_ACCESS_TOKEN' }
        API.findUserByTokenHash(data.hashed_token || data.token_hash, function(err, data) {
            //if (err) { throw new Error('error:', err); }
            if (err) {
                console.error('[findUserByTokenHash] Error:', err, err.stack);
                cb('INTERNAL_ERROR');
                return;
            }

            // if hash didn't resolve to user, create client without user
            //TODO: isn't it more correct to tell the user that they hash is invalid?
            if (data.error) {
                self.addClient(socket, new Client(self, socket, room), cb);
                return;
            }

            var user = data;

            // If user owns app, set their role to owner
            if (_.contains(app.owners, user.uname)) {
                user.role = 'owner';
            }

            // User found, so create client with user
            self.addClient(socket, new Client(self, socket, room, user), cb);
        });
    });

    socket.on('disconnect', function() {
        debug('[disconnect] socket disconnected');
        self.removeSocket(socket);
    });

};

Server.prototype.insertMessage = function(roomName, user, text, cb) {
    debug('[Server#insertMessage] user: %j, text: %j', user, text);

    var message = {
        id: Math.random(), //TODO: Does the messages needs id?
        user: {
            uname: user.uname,
            role: user.role
        },
        text: text
    };

    db.insertChatMessage({
      uname: user.uname,
      role: user.role,
      text: text,
      room_name: roomName
    });

    this.rooms[roomName].history.push(message);

    cb(null, message);
};

Server.prototype.removeSocket = function(socket) {
    var client = this.clients[socket.id];

    if (!client) {
      debug('[removeSocket] Hmm, no client found with socket.id: %j', socket.id);
      return;
    }

    // Client found

    debug('[removeSocket] client: %j', client.socket.id);

    // debug('[removeSocket] client: %j', client.socket.id);
    delete this.clients[socket.id];

    if (client.user) {

        // Does user still have any connected clients?
        // TODO: Need to check if user has any clients *in the room this client just
        // left*
        var aRemainingClient = _.values(this.clients).some(function(c) {
            return c.user && // not every client has a user, so skip the ones that don't
                   c.user.uname === client.user.uname &&
                   c.room === client.room;
        });

        if (aRemainingClient) {
            debug('aRemainingClient: ', aRemainingClient);
        } else {
            // User has no more clients
            debug('NO REMAINING CLIENTS');

            // Remove the user
            delete this.users[client.user.uname];

            // Remove user from room too
            delete this.rooms[client.room].users[client.user.uname];

            // Tell room user has left
            socket.to(client.room).emit('user_left', client.user);
        }
    }

};

// cb: function(err, room)
// Where room is object: { muteList: {}, users: {}, clients: {}, history: CBuffer(250) }
Server.prototype.createOrFetchRoomByName = function(roomName, cb) {
  var self = this;



  debug('[createOrFetchRoomByName] self.rooms[%j]: %j', roomName, self.rooms[roomName]);

  if (self.rooms[roomName]) {
    cb(null, self.rooms[roomName]);
    return;
  }


  debug('room %j did not exist, creating...', roomName);
  db.fetchChatMessagesForRoomName(roomName, function(err, messages) {
    // TODO: Handle err
    // Convert messages into the format that clients expect
    var history = (function() {
      var presentedMessages = messages.map(function(msg) {
        return {
          id: msg.id,
          user: {
            uname: msg.uname,
            role: msg.role
          },
          text: msg.text,
          created_at: msg.created_at
        };
      });

      var history = new CBuffer(250);

      history.push.apply(history, presentedMessages);

      return history;
    })();

    var roomObj = {
      // Map of uname -> Date
      muteList: {},
      users: {},
      clients: {},
      history: history
    };

    self.rooms[roomName] = roomObj;

    cb(null, roomObj);
    return;
  });

};

Server.prototype.addClient = function(socket, client, cb) {
    var self = this;
    debug('[server] adding client. room pre-add: %j', this.rooms[client.room]);

    self.createOrFetchRoomByName(client.room, function(err, roomObj) {
      // TODO: Handle err

      // TODO:Add client to rooms map (Is this TODO still valid?)

      // TODO:Add user to users map if fresh (Is this TODO still valid?)
      if (client.user) {
          var user;
          if (self.users[client.user.uname]) {
              debug('[addClient] %s is not fresh', client.user.uname);
              // user is not fresh
              user = self.users[client.user.uname];
              //user.clients[client.socket.id] = client;
          } else {
              debug('[addClient] %s is fresh', client.user.uname);
              // user is fresh
              user = client.user;
              // user.clients = {};
              // user.clients[client.socket.id] = client;
              self.rooms[client.room].users[client.user.uname] = client.user;
              socket.to(client.room).emit('user_joined', client.user);
          }

          self.users[client.user.uname] = user;
      }

      self.clients[client.socket.id] = client;

      // State configured, so now send initialization payload to the
      // client's `auth` callback.
      var initPayload = {
          user: client.user,
          room: Lib.roomToArray(self.rooms[client.room])
      };
      cb(null, initPayload);
    });

};
