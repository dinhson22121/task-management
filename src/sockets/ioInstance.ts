import { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(instance: Server) {
  io = instance;
}

export function getIo(): Server | null {
  return io;
}
