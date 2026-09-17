import { defineServer, defineRoom, playground } from "colyseus";

import { MafiaRoom } from "./rooms/MafiaRoom.js";

const server = defineServer({
  rooms: {
    mafia_room: defineRoom(MafiaRoom).filterBy(['password']),
  },

  express: (app) => {
    // Dev-панель для тестування кімнат (не expose у production)
    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }
  },
});

export default server;
