// Expose modules.
exports.parse = parse;
exports.format = format;

/**
 * Parse a remote string.
 *
 * @param {string} str
 * @returns {object}
 */

function parse(str) {
  if (!str)
    throw new Error('Host cannot be empty.');

  var matches = str.match(/(.*)@([^:]*):?(.*)/);

  if (!matches)
    return {user: 'deploy', host: str};

  return {user: matches[1], host: matches[2], port: +matches[3] || undefined};
}

/**
 * Format a remote object.
 *
 * @param {object} obj Remote object
 * @returns {string}
 */

function format(obj) {
  var str = obj.user + '@' + obj.host;

  return str;
}
