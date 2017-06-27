var _ = require('lodash');
var path = require('path');
var exec = require('child_process').exec;
var LineWrapper = require('stream-line-wrapper');
var Promise = require('bluebird');
var whereis = require('whereis');
var sprintf = require('sprintf-js').sprintf;
var remote = require('./remote');
var util = require('./util');

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

Connection.prototype.buildSSHCommand = function (command) {
  var connection = this;

  // In sudo mode, we use a TTY channel.
  var isSudo = /^sudo/.exec(command);
  var args = isSudo ? ['-tt'] : [];
  args.push.apply(args, connection.sshArgs);
  args.push(remote.format(connection.remote));

  // Escape double quotes in command.
  command = command.replace(/"/g, '\\"');

  if (_.isString(connection.options.asUser)) {
    if (isSudo) {
      command = command.replace('sudo', '');
    }

    command = 'sudo -u ' + connection.options.asUser + command;
  }

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
    var cmd = connection.buildSSHCommand(command);

    var child = exec(
      cmd,
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
 * Executes the given command with child_process.exec, appropriately transforming the stdout and stderr streams
 * @param {Connection} connection The associated connection object (used exclusively for output decoration)
 * @param {string} cmd
 * @param {Object} cmdOptions Array of options passed to child_process.exec
 * @returns {Promise}
 */

function execCommand(connection, cmd, cmdOptions) {
  return new Promise(function (resolve, reject) {
    // Exec command.
    var child = exec(cmd, cmdOptions, function (err, stdout, stderr) {
      if (err) reject(err);
      else
        resolve({
          child: child,
          stdout: stdout,
          stderr: stderr
        });
    });

    if (connection.options.stdout)
      child.stdout
        .pipe(new LineWrapper({prefix: '@' + connection.remote.host + ' '}))
        .pipe(connection.options.stdout);

    if (connection.options.stderr)
      child.stderr
        .pipe(new LineWrapper({prefix: '@' + connection.remote.host + '-err '}))
        .pipe(connection.options.stderr);

  });

}

/**
 * Performs the copy operation via rsync
 * @param {Object} options
 * @param {Connection} connection
 * @param {string} src
 * @param {string} dest
 * @returns {Promise}
 */

function copyViaRsync(options, connection, src, dest) {
  // Complete src.
  var completeSrc = options.direction === 'remoteToLocal' ?
  remote.format(connection.remote) + ':' + src :
    src;

  // Complete dest.
  var completeDest = options.direction === 'localToRemote' ?
  remote.format(connection.remote) + ':' + dest :
    dest;

  connection.log('Copy "%s" to "%s" via rsync', completeSrc, completeDest);

  // Format excludes.
  var excludes = options.ignores ? formatExcludes(options.ignores) : [];

  // Append options to rsync command.
  var rsyncOptions = excludes.concat(['-az']).concat(options.rsync);

  // Build command.
  var cmd = ['rsync'].concat(rsyncOptions).concat([
    '-e',
    '"ssh ' + connection.sshArgs.join(' ') + '"',
    completeSrc,
    completeDest
  ]).join(' ');

  var cmdOptions = _.omit(options, 'direction');

  return execCommand(connection, cmd, cmdOptions);

}

/**
 * Generates an array of commands to use when copying over scp
 * @param {Object} options
 * @param {Connection} connection
 * @param {string} src
 * @param {string} dest
 * @returns {string[]}
 */

function generateScpCommands(options, connection, src, dest) {
  function generateCommand(cmd, dest) {
    return options.direction === 'remoteToLocal' &&
      dest === 'dest' ||
      options.direction === 'localToRemote' &&
      dest === 'src' ?
      cmd :
      connection.buildSSHCommand(cmd);
  }

  function generatePath(path, dest) {
    var resolvedPath = util.resolveMsysGitPath(path);
      return options.direction === 'remoteToLocal' &&
      dest === 'dest' ||
      options.direction === 'localToRemote' &&
      dest === 'src' ?
      resolvedPath :
      remote.format(connection.remote) + ':' + resolvedPath;
  }

  // Format excludes.
  var excludes = options.ignores ? formatExcludes(options.ignores) : [];

  var packageFile = sprintf('%s.tmp.tar.gz', path.basename(src));
  var fromPath = generatePath(path.dirname(src) + '/' + packageFile, 'src');
  var toPath = generatePath(dest, 'dest');

  var cdSource = ['cd', path.dirname(src)].join(' ');
  var cdDest = ['cd', dest].join(' ');

  var tar = generateCommand(
    [cdSource, ['tar'].concat(excludes).concat('-czf', packageFile, path.basename(src)).join(' ')].join(' && '),
    'src');

   var copy = options.direction === 'localToRemote' ?
    [cdSource, buildSCPCommand(connection, packageFile, toPath)].join(' && ') :
    buildSCPCommand(connection, fromPath, toPath)

  // The command to untar the destination package
  var untar = generateCommand(
    [cdDest, ['tar'].concat('--strip-components', '1', '-xzf', packageFile).join(' ')].join(' && '),
    'dest');

  return [
    tar,
    generateCommand(['mkdir', '-p', dest].join(' '), 'dest'),
    copy,
    generateCommand([cdSource, ['rm', packageFile].join(' ')].join(' && '), 'src'),
    untar,
    generateCommand([cdDest, ['rm', packageFile].join(' ')].join(' && '), 'dest')
  ];
}

/**
 * Performs the copy operation via tar+scp
 * @param {Object} options
 * @param {Connection} connection
 * @param {string} src
 * @param {string} dest
 * @returns {Promise}
 */

function copyViaScp(options, connection, src, dest) {
  var commands = generateScpCommands(options, connection, src, dest);

  var cmdOptions = _.omit(options, 'direction');

  // Executes an array of commands in series
  return Promise.reduce(commands, function (results, cmd) {
    connection.log('Running %s', cmd);
    return execCommand(connection, cmd, cmdOptions).then(function (res) {
      results.stdout += res.stdout;
      results.stderr += res.stderr;
      return results;
    });
  }, {
    stdout: '',
    stderr: ''
  });

}

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

  return isRsyncAvailable().then(function (rsyncAvailable) {
    var handler = rsyncAvailable ? copyViaRsync : copyViaScp;
    return handler(options, this, src, dest);

  }.bind(this)).nodeify(cb);
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
    whereis('rsync', function (err) {
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
    args = args.concat(['-o', 'StrictHostKeyChecking=' + options.strict]);

  return args;
}

/**
 * Build SCP command.
 *
 * @param {Connection} connection
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */

function buildSCPCommand(connection, from, to) {
  var scp = ['scp'];

  if (connection.remote.port) scp = scp.concat('-P', connection.remote.port);
  if (connection.options.key) scp = scp.concat('-i', connection.options.key);

  return scp.concat(from, to).join(' ');

}
