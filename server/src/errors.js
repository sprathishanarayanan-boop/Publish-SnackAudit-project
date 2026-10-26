class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details);
const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, 'FORBIDDEN', msg);
const notFound = (msg = 'Not found') => new HttpError(404, 'NOT_FOUND', msg);
const conflict = (code, msg, details) => new HttpError(409, code, msg, details);
const gone = (code, msg) => new HttpError(410, code, msg);
const unprocessable = (code, msg, details) => new HttpError(422, code, msg, details);

// Wrap async route handlers so rejections reach the error middleware.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, gone, unprocessable, ah };
