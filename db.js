var m = require('multiline');
var pg = require('pg');
var _ = require('lodash');
var debug = require('debug')('app:db');
// First party
var config = require('./config');

var query = function(sql, params, cb) {
  if (_.isFunction(params)) {
    cb = params;
    params = undefined;
  }

  debug('[query] sql: %j, params: %j', sql, params);

  pg.connect(config.database_url, function(err, client, done) {

    if (err) {
      debug('Error fetching client from pool:', err);
      cb(err);
      return;
    }

    client.query(sql, params || [], function(err, result) {
      // Release client back to pool
      done();

      if (err) {
        debug('Error running query:', sql, err);
        cb(err);
        return;
      }

      // Successful query
      cb(null, result);

    });
  });
};

exports.fetchChatMessagesForRoomName = function(roomName, cb) {
  debug('[fetchChatMessagesForRoomName] roomName: %j', roomName);

  var sql = m(function() {/*
SELECT *
FROM chat_messages
WHERE room_name = $1
ORDER BY id DESC
LIMIT 250
  */});

  query(sql, [roomName], function(err, result) {

    if (err) {
      debug('[fetchChatMessagesForRoomName] Error:', err);
      cb(err);
      return;
    }

    // Success
    debug('Result rows: ', result.rows);
    cb(null, result.rows);
  });
};

// data.uname: String
// data.text: String
// data.room_name: String
// data.role: String admin | mod | owner | member
exports.insertChatMessage = function(data, cb) {
  cb = cb || function() {};
  var sql = m(function() {/*
INSERT INTO chat_messages (uname, role, room_name, text)
VALUES ($1, $2, $3, $4)
RETURNING *
  */});

  query(sql, [data.uname, data.role, data.room_name, data.text], function(err, result) {
    if (err) {
      console.error('[insertChatMessage] Error', err);
      cb(err);
      return;
    }

    // Success
    cb(null, result.rows[0]);
  });
};
