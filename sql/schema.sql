
DROP TABLE IF EXISTS chat_messages;

CREATE TABLE chat_messages (
  id         bigserial PRIMARY KEY,
  uname      text NOT NULL,
  role       text NOT NULL,
  text       text NOT NULL,
  room_name  text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT NOW()
);

-- Speed up room_name lookup
CREATE INDEX ON chat_messages (room_name);
