// Seed data arrives with the first domain models (Phase 1). Refuses to run in production.
if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database');
}
console.log('Nothing to seed yet.');
