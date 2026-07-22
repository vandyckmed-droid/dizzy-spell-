import React from 'react';
const mk=name=>({children,...p})=>React.createElement('div',{'data-svg':name},children);
export const Path=mk('path'),Defs=mk('defs'),LinearGradient=mk('lg'),Stop=mk('stop'),Rect=mk('rect'),G=mk('g'),Circle=mk('circle');
const Svg=({children,style})=>React.createElement('div',{style:{...style,minHeight:70},'data-svg':'svg'},children);
export default Svg;
