import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/debenhams_scheduler?replicaSet=rs0&directConnection=true',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};
if (config.jwtSecret === 'dev-only-secret-change-me' && process.env.NODE_ENV === 'production') {
  throw new Error('Set JWT_SECRET in the environment before running in production');
}
