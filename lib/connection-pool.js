var _ = require('lodash');
var Promise = require('bluebird');
var Connection = require('./connection');

// Expose module.
module.exports = ConnectionPool;

/**
 * Initialize a new `ConnectionPool` with `connections`.
 *
 * @param {Connection|string[]} connections Connections
 * @param {object} [options] Options
 */

function ConnectionPool(connections, options) {
  // Create connection if necessary.
  this.connections = connections.map(function (connection) {
    if (connection instanceof Connection) return connection;
    return new Connection(_.extend({remote: connection}, options));
  });
}

/**
 * Run a command on each connection.
 *
 * @param {string} command Command
 * @param {object} [options] Options
 * @param {function} [cb] Callback
 * @returns {Promise}
 */

ConnectionPool.prototype.run = function (command, options, cb) {
  // run(command, cb)
  if (_.isFunction(options)) {
    cb = options;
    options = undefined;
  }

  return Promise.all(this.connections.map(function (connection) {
    return connection.run(command, options);
  })).nodeify(cb);
};

/**
 * Remote copy on each connection.
 *
 * @param {string} src Source
 * @param {string} dest Destination
 * @param {object} options Options
 * @param {function} [cb] Callback
 * @returns {Promise}
 */

ConnectionPool.prototype.copy = function (src, dest, options, cb) {
  // function (src, dest, cb)
  if (_.isFunction(options)) {
    cb = options;
    options = undefined;
  }

  return Promise.all(this.connections.map(function (connection) {
    return connection.copy(src, dest, options);
  })).nodeify(cb);
};
