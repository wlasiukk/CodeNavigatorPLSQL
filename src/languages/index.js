'use strict';

/**
 * Registered language adapters. To add a language create src/languages/<id>/index.js
 * implementing the contract described in src/languages/README.md and list it here.
 */
module.exports = [
    require('./plsql')
];
