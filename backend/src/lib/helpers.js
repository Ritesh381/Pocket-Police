import { ZodError } from 'zod';

// Wraps an async route handler so thrown errors reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Turns a Supabase error into an HTTP error. PostgREST codes:
//   PGRST116 = no rows returned for .single()
export function supabaseError(error, notFoundMessage = 'Not found') {
  if (error?.code === 'PGRST116') {
    const e = new Error(notFoundMessage);
    e.status = 404;
    return e;
  }
  const e = new Error(error?.message || 'Database error');
  e.status = 500;
  e.details = error;
  return e;
}

// Validates a request body against a zod schema; throws a 400 on failure.
export function parseBody(schema, body) {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      const e = new Error('Validation failed');
      e.status = 400;
      e.details = err.flatten();
      throw e;
    }
    throw err;
  }
}
