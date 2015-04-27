var util = {

  /**
   * Resolves a windows path into a valid msysgit path, where applicable
   * @param {string} path
   * @returns {string}
   */
  resolveMsysGitPath: function (path) {
    var matches;
    if ((matches = /^(\w):\\(.*)$/.exec(path)) !== null) {
      return '/' + matches[1] + '/' + matches[2].replace(/\\/g, '/');
    } else
      return path;
  }
};

module.exports = util;