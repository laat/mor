// @flow
import hasFlag from 'has-flag';

export default () => process.env.isTTY || hasFlag('verbose');
