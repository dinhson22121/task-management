import { Server, Socket } from 'socket.io';

export function initSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    socket.on('joinPool', (poolId: string) => socket.join(poolId));
    socket.on('leavePool', (poolId: string) => socket.leave(poolId));
  });
}
