'use strict';

import diagnostics from 'diagnostics';
import resolve from 'resolve';
import path from 'path';
import fs from 'fs';

const debug = diagnostics('sass-import-modules');

/**
 * Append extension to file if required.
 *
 * @param {String} file File path.
 * @param {String} ext File extension.
 * @returns {String} file.
 * @api private
 */
function extension(file, ext) {
  if (!~file.indexOf(ext)) {
    file += ext;
  }

  return file;
}

/**
 * Resolve the file in node_modules.
 *
 * @param {String} base Current directory.
 * @param {String} file File path.
 * @param {String} ext File extension.
 * @param {Function} next Completion callback.
 * @returns {void}
 * @api private
 */
function node(base, file, ext, next)  {
  debug('Resolving file from node_modules: %s', file);

  return void resolve(extension(file, ext), { basedir: base }, (error, result) => {
    if (result) {
      return next(null, result);
    }

    resolve(file, { basedir: base }, next);
  });
}

/**
 * Resolve the file locally.
 *
 * @param {String} file File path.
 * @param {String} base Current directory.
 * @param {String} ext File extension.
 * @param {Function} next Completion callback.
 * @returns {void}
 * @api private
 */
function local(base, file, ext, next) {
  debug('Resolving file locally: %s', file);
  file = extension(path.join(base, file), ext);

  return void exists(file, exist => {
    next(null, exist ? file : null);
  });
}

/**
 * Return the file path to node-sass.
 *
 * @param {String} file Absolute path to file.
 * @param {Function} done Completion callback.
 * @returns {void}
 * @api private
 */
function provide(file, done) {
  return void done({ file });
}

/**
 * Check if the file exists.
 *
 * @param {String} file
 * @param {Function} done Completion callback
 * @returns {void}
 * @api private
 */
function exists(file, done) {
  return void fs.stat(file, (error, stat) => {
    done(!error && !!stat);
  });
}

/**
 * Setup an importer for node-sass.
 *
 * @param {Object} options Optional configuration.
 * @returns {Function} Importer.
 * @api public
 */
export function importer({ root = process.cwd(), ext = '.scss' } = {}) {
  if (ext.charAt(0) !== '.') {
    ext = '.' + ext;
  }

  /**
   * Importer for SASS.
   *
   * @param {String} url File to resolve.
   * @param {String} prev Last resolved file.
   * @param {Function} done Completion callback.
   * @returns {void} Return early.
   * @api private
   */
  return function resolve(url, prev, done) {
    const options = this.options || {};
    const dirnamePrev = path.dirname(prev);
    const includes = [].concat(options.includePaths, dirnamePrev, root).filter(Boolean);
    const fns = [local, node].reduce((arr, fn) => {
      return arr.concat(includes.map(base => fn.bind(fn, base)));
    }, []);

    //
    // 1. Find the file relative to the previous discovered file.
    // 2. Find the file or module in node_modules.
    //
    debug('Resolving: %s', url);
    (function run(stack, error) {
      /**
       * Completion callback.
       *
       * @param {Error} err Error returned from resolver.
       * @param {String} file Full path to file.
       * @returns {Void} return early.
       * @api private
       */
      function next(err, file) {
        error = error || err;

        //
        // Resolved to a file on disk, return the file early.
        //
        if (file) {
          return void provide(file, done);
        }

        //
        // All resolvers ran, no results found, return error if any.
        //
        if (!stack.length) {
          if (error) throw new Error(`Could not find file: ${url} from parent ${prev}`);
          return void done();
        }

        //
        // Iterate over the stack.
        //
        debug('Stack step complete, iterating over remaining %d', stack.length);
        return void run(stack, err, next);
      }

      //
      // Edge case where the source might not be a file, e.g. data was provided.
      // The proper path is likely the first index of `sass.includePaths` as that is
      // the root of the build.
      //

      stack.shift()(url, ext, next);
    })(fns);
  }
};