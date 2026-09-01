import { WebRTCController } from '../controllers/WebRTCController.js';

export const registerWebRTCRoutes = (socket, io) => {
  WebRTCController.handle(socket, io);
};
