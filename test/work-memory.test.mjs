import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MEMORY_TOOLS, workContext, memoryArguments} from '../scripts/lib/work-memory.mjs';

test('repository context is supplied afresh and never silently broadened',()=>{
 const a=workContext('codex',{key:'first'},{CODEX_THREAD_ID:'thread-1'});
 const b=workContext('codex',{key:'second'},{CODEX_THREAD_ID:'thread-1'});
 assert.equal(memoryArguments('search_my_work',{query:'certbot'},a).project_key,'first');
 assert.equal(memoryArguments('search_my_work',{query:'certbot'},b).project_key,'second');
 assert.equal(memoryArguments('search_my_work',{query:'certbot',scope:'all'},b).project_key,undefined);
 assert.equal(workContext('codex',null,{}).project_key,null);
});

test('all four agents attach proven identity and preserve selected task',()=>{
 for(const [agent,env,explicit] of [['claude-code',{CLAUDE_SESSION_ID:'claude-1'}],['codex',{CODEX_THREAD_ID:'codex-1'}],['pi',{PI_SESSION_ID:'pi-1'}],['cursor',{},'cursor-1']]){
   const context=workContext(agent,{key:'repo'},env,explicit);
   const args=memoryArguments('attach_session_to_task',{task_id:'selected'},context);
   assert.equal(args.task_id,'selected'); assert.equal(args.session_id,context.session_id);
   assert.ok(args.client.endsWith('_plugin'));
   assert.throws(()=>memoryArguments('attach_session_to_task',{session_id:'wrong'},context),/not the current/);
 }
});

test('an unknown session stays unknown, including Cursor and cloud Claude',()=>{
 for(const agent of ['claude-code','codex','pi','cursor']){
  const context=workContext(agent,null,{});
  assert.equal(context.session_id,null);
  assert.throws(()=>memoryArguments('attach_session_to_task',{task_id:'selected'},context),/actual current session/);
 }
 assert.equal(MEMORY_TOOLS.length,4);
});


test('an explicit session id cannot override a known current client session', () => {
    assert.throws(() => workContext('codex', null, {CODEX_THREAD_ID:'current'}, 'different'), /not the current/);
    assert.equal(workContext('codex', null, {CODEX_THREAD_ID:'current'}, 'current').session_id, 'current');
});


test('an explicit project filter takes precedence over the current checkout', () => {
    const context = workContext('codex', {key: 'current'}, {CODEX_THREAD_ID: 'thread-1'});
    assert.equal(memoryArguments('search_my_work', {query: 'certbot', project_key: 'selected'}, context).project_key, 'selected');
    assert.deepEqual(memoryArguments('search_my_work', {query: 'certbot', project_id: 'selected-id'}, context), {query: 'certbot', project_id: 'selected-id'});
});
