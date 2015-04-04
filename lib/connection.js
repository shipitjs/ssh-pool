var _ = require('lodash');
var path = require('path');
var exec = require('child_process').exec;
var LineWrapper = require('stream-line-wrapper');
var Promise = require('bluebird');
var whereis = require('whereis');
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
    port: this.remote.port,
    strict: this.options.strict
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
 * Builds a command that will be executed remotely through SSH
 * @param {string} command
 * @returns {string}
 */
Connection.prototype.buildSshCommand = function (command) {

  var connection = this;

  // In sudo mode, we use a TTY channel.
  var args = /^sudo/.exec(command) ? ['-tt'] : [];
  args.push.apply(args, connection.sshArgs);
  args.push(remote.format(connection.remote));

  // Escape double quotes in command.
  command = command.replace(/"/g, '\\"');

  // Complete arguments.
  args = ['ssh'].concat(args).concat(['"' + command + '"']);

  return args.join(' ');

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

    // Log wrappers.
    var stdoutWrapper = new LineWrapper({prefix: '@' + connection.remote.host + ' '});
    var stderrWrapper = new LineWrapper({prefix: '@' + connection.remote.host + '-err '});

    // Exec command.
    var child = exec(
      connection.buildSshCommand(command),
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
 * @param {object} [options.direction] Direction of copy
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
    direction: 'localToRemote',
    rsync: []
  });

  var connection = this;

  return isRsyncAvailable().then(function (rsyncAvailable) {

    return new Promise(function (resolve, reject) {

      // Complete src.
      var completeSrc = options.direction === 'remoteToLocal' ?
      remote.format(connection.remote) + ':' + src :
        src;

      // Complete dest.
      var completeDest = options.direction === 'localToRemote' ?
      remote.format(connection.remote) + ':' + dest :
        dest;

      // Format excludes.
      var excludes = options.ignores ? formatExcludes(options.ignores) : [];

      var cmd = null;

      if (rsyncAvailable && !options.useShim) {

        // Append options to rsync command.
        var rsyncOptions = excludes.concat(['-az']).concat(options.rsync);

        // Build command.
        cmd = ['rsync'].concat(rsyncOptions).concat([
          '-e',
          '"ssh ' + connection.sshArgs.join(' ') + '"',
          completeSrc,
          completeDest
        ]).join(' ');

      } else {

        var pkgname = path.basename(src) + '.tar.gz';

        var tarCd = ['cd', path.dirname(src)].join(' ');

        var tar = [tarCd, ['tar'].concat(excludes).concat('-czf', pkgname, path.basename(src)).join(' ')].join('; ');
        if (options.direction === 'remoteToLocal')
          tar = connection.buildSshCommand(tar);

        var fromFile = options.direction === 'localToRemote' ?
        path.dirname(src) + '/' + pkgname :
        remote.format(connection.remote) + ':' + path.dirname(src) + '/' + pkgname;

        var toFile = options.direction === 'remoteToLocal' ?
          path.dirname(dest) :
        remote.format(connection.remote) + ':' + path.dirname(dest);

        var scp = ['scp'];

        if (connection.remote.port)
          scp = scp.concat('-P', connection.remote.port);

        if (connection.remote.key)
          scp = scp.concat('-i', connection.remote.key);

        scp = scp.concat(fromFile, toFile);

        var untarCd = ['cd', path.dirname(dest)].join(' ');

        var untar = [untarCd, ['tar'].concat('-xzf', pkgname).join(' ')].join('; ');
        if (options.direction === 'localToRemote')
          untar = connection.buildSshCommand(untar);

        cmd = [tar, scp.join(' '), untar].join('; ');

      }

      connection.log('Remote copy "%s" to "%s"', completeSrc, completeDest);

      // Log wrappers.
      var stdoutWrapper = new LineWrapper({prefix: '@' + connection.remote.host + ' '});
      var stderrWrapper = new LineWrapper({prefix: '@' + connection.remote.host + '-err '});

      // Exec command.
      var child = exec(cmd, _.omit(options, 'direction'), function (err, stdout, stderr) {
        if (err) return reject(err);
        resolve({
          child:  child,
          stdout: stdout,
          stderr: stderr
        });
      });

      if (connection.options.stdout)
        child.stdout.pipe(stdoutWrapper).pipe(connection.options.stdout);

      if (connection.options.stderr)
        child.stderr.pipe(stderrWrapper).pipe(connection.options.stderr);

    })

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
    return prev.concat(['--exclude', '"' + current + '"']);
  }, []);
}

/**
 * Checks whether the rsync binary is available
 *
 * @returns {Promise.<boolean>}
 */
function isRsyncAvailable() {
  return new Promise(function (resolve) {
    whereis('rsync', function (err, path) {
      resolve(!err);
    });
  });
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

  if (options.strict)
    args = args.concat(['-o',  'StrictHostKeyChecking=' + options.strict]);

  return args;
}
