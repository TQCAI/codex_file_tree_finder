const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function load(){
 const calls=[],listeners=new Set();
 const selection={isCollapsed:false,rangeCount:1,toString:()=> '  代码选区\n',removeAllRanges(){this.isCollapsed=true;}};
 const window={getSelection:()=>selection,addEventListener(type,fn){listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}};
 const context={window};vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../src/selection.js'),'utf8').replace('export { bind };','globalThis.bind=bind;'),context);
 let prevented=0;
 const event={key:'u',metaKey:true,composedPath:()=>[],preventDefault(){prevented++;},stopImmediatePropagation(){}};
 return {selection,calls,bind:(text='代码选区')=>context.bind(t=>calls.push(t),text,'actions'),fire:extra=>{for(const fn of listeners)fn({...event,...extra});},context,get prevented(){return prevented;}};
}
test('native trimmed text works even when browser selection has whitespace; unmount removes handler',()=>{
 const x=load();const cleanup=x.bind();x.fire();x.fire();assert.deepEqual(x.calls,['代码选区']);assert.equal(x.prevented,2);cleanup();x.fire();assert.equal(x.calls.length,1);
});
test('shadow-root editor selection does not require a window DOM range',()=>{
 const x=load();x.context.window.getSelection=()=>null;x.bind();x.fire();assert.deepEqual(x.calls,['代码选区']);
});
test('file editor contenteditable selection is supported; chat composer and instruction inputs are ignored',()=>{
 for(const fileEditor of [false,true]){
  const x=load();x.bind();
  const element={nodeType:1,closest:selector=>selector.startsWith('.cm-editor')?fileEditor:true};
  x.fire({composedPath:()=>[element]});assert.equal(x.calls.length,fileEditor?1:0);
 }
});
test('modifier variants, composing, repeats, pending and edit modes do not invoke native callback',()=>{
 const x=load();x.bind();
 for(const extra of [{metaKey:false},{ctrlKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{defaultPrevented:true},{key:'x'},{repeat:true}])x.fire(extra);
 assert.equal(x.calls.length,0);
 assert.equal(x.context.bind(()=>{},'代码选区','edit'),undefined);
 assert.equal(x.context.bind(()=>{},'代码选区','pending'),undefined);
 assert.equal(x.context.bind(null,'代码选区','actions'),undefined);
 assert.equal(x.context.bind(()=>{},'  ','actions'),undefined);
});
test('only the most recent native overlay handles a key',()=>{
 const x=load();x.bind('old');const cleanup=x.bind('new');x.fire();assert.deepEqual(x.calls,['new']);cleanup();x.fire();assert.deepEqual(x.calls,['new','old']);
});
