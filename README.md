# chat-server

This is Moneypot's chat server which you can use to integrate a websocket chatbox on your site.

## Usage

The chat-server uses [socket.io](http://socket.io/), so you'll want to use a socket.io client to connect.

Our chat-server is running on `https://a-chat-server.herokuapp.com`.

Here's how to connect:

``` javascript
<script src="vendor/javascript/socket.io-client.js"></script>
<script type="text/javascript">
  var socket = io('https://a-chat-server.herokuapp.com');

  socket.emit('connect', function() {
    console.log('socket connected');
  });

  socket.emit('disconnect', function() {
    console.log('socket disconnected');
  });
</script>
```

When you connect to that chat server, immediately send an "auth" event with this payload:

``` javascript
{
  app_id: Integer,   (Required)
  hashed_token: String (Optional)
}
```



For example:

``` javascript
socket.emit('connect', function() {
  socket.emit('auth', authPayload, function(err, data) {
    if (err) ...
  })
});
```

The chat server will automatically subscribe you to the app's lobby channel.

`hashed_token` is `sha256` of either the `confidential_token` or `access_token)` (depending if the app is using confidential flow or implicit flow). In the case of confidential_flow, the `hashed_token` should be computed by the server, and sent to the client, which will use it for login. If the `hashed_token` is valid, it represents a logged-in user. If missing or if the hashed_token is invalid, then the socket will only be able to read new messages and will not be able to create any messages.

You must also provide a callback with signature `fn(err, data)`.

If auth is successful, the `data` response will provide you with the necessary information to sync your chatbox with the server.

`data` looks like this:

``` javascript
{
  // User of the hashed_token you provided
  // Only exists if hashed_token was provided and valid
  user: {
    id: 69,
    uname: 'donald',
    role: 'admin' | 'mod' | 'owner'
  },
  // The state of the app's lobby channel
  // Always present
  room: {
    // Object of users in the channel, keyed by their case-sensitive usernames
    // Always present
    users: {
      <UNAME>: <OBJECT>,
      foo: { id: 42, uname: 'foo', role: 'admin' | 'mod' | 'owner' }
    },
    // Array of messages in the channel (oldest to newest)
    // - id: Integer, unique incrementing id of message
    // - user: Object
    // - text: String
    // Always present
    history: [
      {
        id: 2,
        user: { uname: 'foo', role: 'owner' },
        text: 'Hello, world!'
      },
      ...
    ]
    // Object of muted unames, keyed by lowercase unames
    // - mins: Integer of mute duration in minutes
    // - expires_at: String of ISO-format timestamp of when the mute ends
    //   e.g. var date = Date.parse(timestamp)
    // TODO: Only present if auth'd user is owner|admin|mod
    muteList: {
      'foo': { uname: 'foo', mins: 30, expires_at: '2015-05-07T21:07:40.322Z' }
    }
  }
}
```

`auth` callback error constants:

- `"INTERNAL_ERROR"`: There was a problem talking to Moneypot's API.
- There are no other possible errors. If you don't send an `app_id`, then you'll get a `client_error` event and you need to fix your client. If you send an invalid `hashed_token`, then you simply get the auth payload back without a user key.


## Events to listen for

Important: When displaying data/messages received from the chat server, ensure cross-site scripting like `<script>alert("hello")</script>` is impossible by escaping it.

- `user_joined`: Sent when a user joins the chat. Payload is an object: `{ uname: String, role: 'admin' | 'mod' | 'owner' }`.
- `user_left`: Sent when a user leaves the chat. Payload is an object: `{ uname: String, role: 'admin' | 'mod' | 'owner' }`.
- `user_muted`: Sent when a user is muted. Payload is an object: `{ uname: String, mins: Integer (duration in minutes), expires_at: String (ISO timestamp) }`.
- `user_unmuted`: Sent when a user is unmuted. Payload is an object: `{ uname: String }`.
- `new_message`: Sent when the chat receives a new message. Payload is an object: `{ user: { uname: String, role: String }, id: Integer, text: String }`.
- `client_error`: Payload is a String. This event is emitted with a human-/developer-friendly error message any time your client disobeys the API. In other words, a client that complies with the chat-server API should never receive this event, but you should listen for it to help catch any client errors and bugs.
- `system_message`: Payload is string. Sent as server feedback to the user. For example, if they type in `/mute foo 10`, the server will send this event with the message `"foo was muted for 10 min"`.

## Sending a new chat message

- `text` is a string. Must be 1-350 characters. You should `text.trim()` before sending.

``` javascript
socket.emit('new_message', text, function(err) {
  if (err) {
    ...
  }
});
```

If `err` is present, it will be a string. Possible constants:

- `"USER_REQUIRED"`
- `"INTERNAL_ERROR"`

The server will send feedback to the user via a `system_message` event with a string payload. Examples: `"User not in mutelist"`, `"User muted"`. These are intended to be displayed in the chatbox.

## Full example

Here's a fully working chat-server client that may help you get started.

``` javascript

<script type="text/javascript">
  var config = {
    chat_uri: 'https://a-chat-server.herokuapp.com',
    hashed_token: '5fef422fb4e79a1785868b87abb3d3932ea5621c23ab2e9b13ee2167f12542cb', // See section above about hashed tokens
    app_id: 2
  };

  var socket = io(config.chat_uri);

  socket.on('connect', function() {
    console.log('[socket] Connected');

    socket.on('disconnect', function() {
      console.log('[socket] Disconnected');
    });

    socket.on('system_message', function(text) {
      console.log('[socket] Received system message:', text);
    });

    // message is { text: String, user: { role: String, uname: String} }
    socket.on('new_message', function(message) {
      console.log('[socket] Received chat message:', message);
    });

    socket.on('user_muted', function(data) {
      console.log('[socket] User muted:', data);
    });

    socket.on('user_unmuted', function(data) {
      console.log('[socket] User unmuted:', data);
    });

    socket.on('user_joined', function(data) {
      console.log('[socket] User joined:', data);
    });

    socket.on('user_left', function(data) {
      console.log('[socket] User left:', data);
    });

    // Received when your client doesn't comply with chat-server api
    socket.on('client_error', function(text) {
      console.warn('[socket] Client error:', text);
    });

    // Once we connect to chat server, we send an auth message to join
    // this app's lobby channel.


    var authPayload = { app_id: config.app_id, hashed_token: config.hashed_token};
    socket.emit('auth', authPayload, function(err, data) {
      if (err) {
        console.log('[socket] Auth failure:', err);
        return;
      }
      console.log('[socket] Auth success:', data);

      // If successful auth and if a user is connected to chat, then
      // send a message:

      if (data.user) {
        socket.emit('new_message', 'Hello, world!', function(err) {
          console.warn('[socket] err when sending message:', err);
          return
        });

        console.log('[socket] Successfully sent message to server');
      }

    });
  });
</script>

```
