import crypto from 'crypto';
import isEqual from 'lodash.isequal';
import omit from 'lodash.omit';
import MemoryStore from './session/memory';
import Cookie from './session/cookie';
import Session from './session/session';
//  environment
const env = process.env.NODE_ENV;

const generateSessionId = () => crypto.randomBytes(16).toString('hex');

const session = (handler, options = {}) => {
  const name = options.name || 'sessionId';
  const cookieOptions = options.cookie || {};
  const store = options.store || new MemoryStore();
  const generateId = options.generateId || generateSessionId;

  //  Notify MemoryStore should not be used in production
  if (env === 'production' && store instanceof MemoryStore) {
    // eslint-disable-next-line no-console
    console.warn('MemoryStore is not designed for production environment.');
  }

  //  Validate parameters
  if (typeof generateId !== 'function') throw new TypeError('generateId option must be a function');


  //  Session generation function
  store.generate = (req) => {
    req.sessionId = generateId(req);
    req.session = new Session(req);
    req.session.cookie = new Cookie(cookieOptions);
    return req.session;
  };

  //  Create session object (req.session) from store fetched session
  store.createSession = (req, sess) => {
    const thisSess = sess;
    const { expires } = thisSess.cookie;
    thisSess.cookie = new Cookie(thisSess.cookie);
    if (typeof expires === 'string') thisSess.cookie.expires = new Date(expires);
    req.session = new Session(req, thisSess);
    return req.session;
  };

  //  store readiness
  const storeReady = true;

  return async (req, res) => {
    //  No need to redefined
    if (req.session) return handler(req, res);

    //  check for store readiness before proceeded
    if (!storeReady) return handler(req, res);

    //  TODO: add pathname mismatch check

    //  Expose store
    req.sessionStore = store;

    //  Get sessionId cookie from Next.js parsed req.cookies
    req.sessionId = req.cookies[name];

    let sess;
    if (!req.sessionId) {
      //  If no sessionId found in Cookie header, generate one
      sess = await JSON.parse(JSON.stringify(req.sessionStore.generate(req)));
    } else {
      sess = await req.sessionStore.get(req.sessionId);
      if (sess) {
        //  Session of req.sessionId found
        req.sessionStore.createSession(req, sess);
      } else {
      //  no session of req.sessionId found
        sess = JSON.parse(JSON.stringify(await req.sessionStore.generate(req)));
      }
    }

    //  Proxy res.end
    const oldEnd = res.end;
    res.end = function resEndProxy(...args) {
      /**
       *  reset expires to prolong session
       *  req.session.cookie.resetExpires();
       *  TODO: Implementing touch() + rollingSession
       *  */

      //  save session to store if there are changes (and there is a session)
      if (req.session) {
        if (!isEqual(omit(req.session, ['cookie']), omit(sess, ['cookie']))) {
          req.session.save();
        }
      }

      //  set the cookie to header if sessionId mismatch or no sessionId found in header Cookie
      if (req.cookies[name] !== req.sessionId && req.session) {
        res.setHeader('Set-Cookie', req.session.cookie.serialize(name, req.sessionId));
      }

      oldEnd.apply(this, args);
    };

    return handler(req, res);
  };
};

export default session;
