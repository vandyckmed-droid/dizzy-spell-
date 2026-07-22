const mem={};
export default {getItem:k=>Promise.resolve(k in mem?mem[k]:null),setItem:(k,v)=>{mem[k]=v;return Promise.resolve();},removeItem:k=>{delete mem[k];return Promise.resolve();}};
