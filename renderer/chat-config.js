/* Shared connection rules for the renderer and main process. */
(function(root){
  const protocols=['auto','chat','responses','messages'];
  const thinkingModes=['auto','none','deepseek','responses','adaptive','budget'];
  function resolve(config){
    const url=new URL(config.baseUrl);
    const profile=(config.modelProfiles||[]).find(p=>p.model===config.model)||{};
    let protocol=profile.protocol&&profile.protocol!=='auto'?profile.protocol:config.apiProtocol||'auto';
    if(protocol==='auto'){
      if(url.hostname==='opencode.ai') protocol=/^claude-/.test(config.model)?'messages':/^(gpt-|o[1-9])/.test(config.model)?'responses':'chat';
      else if(/[/]chat[/]completions[/]?$/.test(url.pathname)) protocol='chat';
      else if(/[/]responses[/]?$/.test(url.pathname)||url.hostname==='api.openai.com') protocol='responses';
      else if(/[/]messages[/]?$/.test(url.pathname)||url.hostname==='api.anthropic.com') protocol='messages';
      else protocol='chat';
    }
    let thinkingMode=profile.thinkingMode||'auto';
    if(thinkingMode==='auto') thinkingMode=url.hostname==='api.deepseek.com'&&protocol==='chat'?'deepseek':'none';
    return {protocol,thinkingMode};
  }
  function models(config){
    const host=new URL(config.baseUrl).hostname;
    const list=host==='api.deepseek.com'?['deepseek-flash','deepseek-v4-pro']:host==='opencode.ai'?['deepseek-v4-flash','deepseek-v4-pro','gpt-5.4','claude-sonnet-4-6']:host==='api.openai.com'?['gpt-5.4']:host==='api.anthropic.com'?['claude-sonnet-4-6']:[];
    return [...new Set([...list,...(config.modelProfiles||[]).map(p=>p.model),config.model])];
  }
  const api={protocols,thinkingModes,resolve,models};
  if(typeof module==='object') module.exports=api; else root.ChatConfig=api;
})(globalThis);
