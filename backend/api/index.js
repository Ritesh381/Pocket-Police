// Vercel serverless entry point. An Express app is itself a (req, res) handler,
// so exporting it lets Vercel invoke the whole API as one function. The vercel.json
// rewrite sends every path here, and Express does the routing.
import app from '../src/app.js';

export default app;
