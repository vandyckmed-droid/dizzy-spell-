import React from 'react';
// Test-harness stub: map react-native-svg primitives to real DOM SVG elements so
// the headless renderer actually draws charts (props pass straight through; React
// handles the SVG namespace + camelCase→dashed attribute mapping).
const pass = (tag) => ({ children, ...p }) => React.createElement(tag, p, children);
export const Path = pass('path'), Defs = pass('defs'), Stop = pass('stop'),
  Rect = pass('rect'), G = pass('g'), Circle = pass('circle'), Line = pass('line'),
  Text = pass('text');
export const LinearGradient = ({ children, ...p }) => React.createElement('linearGradient', p, children);
export const RadialGradient = ({ children, ...p }) => React.createElement('radialGradient', p, children);
const Svg = ({ children, width, height, style }) =>
  React.createElement('svg', { width, height, style }, children);
export default Svg;
