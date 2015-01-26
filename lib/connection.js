var _ = require('lodash');
var exec = require('child_process').exec;
var LineWrapper = require('stream-line-wrapper');
var Promise = require('promise');
var remote = require('./remote');

// Expose connection.
module.exports = Connection;

/**
 * Initialize a new `Connection` with `options`.
 *
 * @param {object} options Options
 * @param {string|object} options.remote Remote
 * @param {Stream} [options.stdout] Stdout stream
 * @param {Stream} [options.stderr] Stderr stream
 * @param {string} [options.key] SSH key
 * @param {function} [options.log] Log method
 */

function Connection(options) {
  this.options = options || {};
  this.remote = _.isString(this.options.remote) ?
    remote.parse(this.options.remote) :
    this.options.remote;
  this.sshArgs = buildSSHArgs({
    key: this.options.key,
    port: this.remote.port
  });
}

/**
 * Log using the logger.
 */

Connection.prototype.log = function () {
  if (this.options.log)
    this.options.log.apply(null, arguments);
};

/**
 * Run a new SSH command.
 *
 * @param {string} command Command
 * @param {object} [options] Exec options
 * @param {function} [cb] Callback
 * @returns {Promise}
 */

Connection.prototype.run = function (command, options, cb) {
  // run(command, cb)
  if (_.isFunction(options)) {
    cb = options;
    options = undefined;
  }

  options = _.defaults(options || {}, {
    maxBuffer: 1000 * 1024
  });

  var connection = this;

  return new Promise(function (resolve, reject) {
    connection.log('Running "%s" on host "%s".', command, connection.remote.host);

    // In sudo mode, we use a TTY channel.
    var args = /^sudo/.exec(command) ? ['-tt'] : [];
    args.push.apply(args, connection.sshArgs);
    args.push(remote.format(connection.remote));

    // Escape double quotes in command.
    command = command.replace(/"/g, '\\"');

    // Complete arguments.
    args = ['ssh'].concat(args).concat(['"' + command + '"']);

    // Log wrappers.
    var stdoutWrapper = new LineWrapper({prefix: '@' + connection.remote.host + ' '});
    var stderrWrapper = new LineWrapper({prefix: '@' + connection.remote.host + '-err '});

    // Exec command.
    var child = exec(
      args.join(' '),
      options,
      function(err, stdout, stderr) {
        if (err) return reject(err);
        resolve({
          child: child,
          stdout: stdout,
          stderr: stderr
        });
      }
    );

    if (connection.options.stdout)
      child.stdout.pipe(stdoutWrapper).pipe(connection.options.stdout);

    if (connection.options.stderr)
      child.stderr.pipe(stderrWrapper).pipe(connection.options.stderr);
  }).nodeify(cb);
};

/**
 * Remote file copy.
 *
 * @param {string} src Source
 * @param {string} dest Destination
 * @param {object} [options] Exec Options
 * @param {function} [cb] Callback
 * @returns {Promise}
 */

Connection.prototype.copy = function (src, dest, options, cb) {
  // function (src, dest, cb)
  if (_.isFunction(options)) {
    cb = options;
    options = {};
  }

  options = _.defaults(options || {}, {
    maxBuffer: 1000 * 1024,
    remoteSrc: (typeof options.remoteDest !== 'undefined') ? !options.remoteDest : false,
    remoteDest: (typeof options.remoteSrc !== 'undefined') ? !options.remoteSrc : true
  });

  var connection = this;

  return new Promise(function (resolve, reject) {
    // Complete src.
    var completeSrc = options.remoteSrc ? remote.format(connection.remote) + ':' + src : src;

    // Complete dest.
    var completeDest = options.remoteDest ? remote.format(connection.remote) + ':' + dest : dest;

    // Format excludes.
    var excludes = options.ignores ? formatExcludes(options.ignores) : [];

    // Build command.
    var args = ['rsync'].concat(excludes).concat([
      '-az',
      '-e',
      '"ssh ' + connection.sshArgs.join(' ') + '"',
      completeSrc,
      completeDest
    ]);

    connection.log('Remote copy "%s" to "%s"', src, completeDest);

    // Log wrappers.
    var stdoutWrapper = new LineWrapper({prefix: '@' + connection.remote.host + ' '});
    var stderrWrapper = new LineWrapper({prefix: '@' + connection.remote.host + '-err '});

    // Exec command.
    var child = exec(args.join(' '), options, function (err, stdout, stderr) {
      if (err) return reject(err);
      resolve({
        child: child,
        stdout: stdout,
        stderr: stderr
      });
    });

    if (connection.options.stdout)
      child.stdout.pipe(stdoutWrapper).pipe(connection.options.stdout);

    if (connection.options.stderr)
      child.stderr.pipe(stderrWrapper).pipe(connection.options.stderr);
  }).nodeify(cb);
};

/**
 * Format excludes to rsync excludes.
 *
 * @param {string[]} excludes
 * @returns {string[]}
 */

function formatExcludes(excludes) {
  return excludes.reduce(function (prev, current) {
    return prev.concat(['--exclude', '"' + current +  '"']);
  }, []);
}

/**
 * Build ssh args.
 *
 * @param {object} options Options
 * @param {number} options.port Port
 * @param {string} options.key Key
 * @returns {string[]}
 */

function buildSSHArgs(options) {
  var args = [];

  if (options.port)
    args = args.concat(['-p', options.port]);

  if (options.key)
    args = args.concat(['-i', options.key]);

  return args;
}
