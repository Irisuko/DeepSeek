/* Shared connection rules for the renderer and main process. */
(function(root){
  const protocols=['auto','chat','responses','messages'];
  const thinkingModes=['auto','none','deepseek','responses','adaptive','budget'];
  function resolve(config){
    if(Array.isArray(config.connections))return route(config)||{protocol:'chat',thinkingMode:'none'};
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
  const platforms={
    deepseek:{name:'DeepSeek 官方',baseUrl:'https://api.deepseek.com'},
    go:{name:'OpenCode Go',baseUrl:'https://opencode.ai/zen/go/v1'},
    zen:{name:'OpenCode Zen',baseUrl:'https://opencode.ai/zen/v1'},
  };
  const deepseekModels=['deepseek-v4.1-flash','deepseek-v4-pro'];
  const zenModels=['gpt-6-astra','gpt-5.6-sol','claude-fable-5-1'];
  const labels={
    'deepseek-v4.1-flash':'DeepSeek V4.1 Flash','deepseek-v4-pro':'DeepSeek V4 Pro',
    'gpt-6-astra':'GPT 6 Astra','gpt-5.6-sol':'GPT 5.6 Sol','claude-fable-5-1':'Claude Fable 5.1',
  };
  function provider(baseUrl){
    const url=new URL(baseUrl);
    if(url.hostname==='opencode.ai') return /^[/]zen[/]go(?:[/]|$)/.test(url.pathname)?'go':'zen';
    return url.hostname==='api.deepseek.com'?'deepseek':'unsupported';
  }
  function models(config){
    const connected=new Set((config.connections||[]).map(c=>c.provider));
    const list=[];
    if(connected.has('zen'))list.push(...zenModels);
    if(connected.has('deepseek')||connected.has('go'))list.push(...deepseekModels);
    for(const p of config.modelProfiles||[]){
      if(!connected.has(p.provider)||deepseekModels.includes(p.model)||zenModels.includes(p.model))continue;
      list.push(p.model);
    }
    return [...new Set(list)];
  }
  function selectedModel(config){
    const list=models(config);
    const current=['deepseek-flash','deepseek-v4-flash'].includes(config.model)?'deepseek-v4.1-flash':config.model;
    return list.includes(current)?current:(list[0]||'');
  }
  function candidates(config,model=config.model){
    const connections=config.connections||[];
    const order=deepseekModels.includes(model)?['deepseek','go','zen']:zenModels.includes(model)?['zen']:[(config.modelProfiles||[]).find(p=>p.model===model)?.provider];
    return order.map(provider=>connections.find(c=>c.provider===provider)).filter(Boolean);
  }
  function route(config,model=config.model){
    const connection=candidates(config,model)[0];
    if(!connection)return null;
    const profile=(config.modelProfiles||[]).find(p=>p.model===model&&p.provider===connection.provider);
    const apiModel=model==='deepseek-v4.1-flash'&&connection.provider==='deepseek'?'deepseek-flash':model;
    const protocol=profile?.protocol&&profile.protocol!=='auto'?profile.protocol:connection.provider==='zen'&&/^claude-/.test(model)?'messages':connection.provider==='zen'&&/^(gpt-|o[1-9])/.test(model)?'responses':'chat';
    const thinkingMode=profile?.thinkingMode&&profile.thinkingMode!=='auto'?profile.thinkingMode:connection.provider==='deepseek'?'deepseek':'none';
    return {provider:connection.provider,baseUrl:connection.baseUrl,model:apiModel,protocol,thinkingMode};
  }
  function modelLabel(id){return labels[id]||id;}
  function isBuiltIn(id){return Object.hasOwn(labels,id);}
  const api={protocols,thinkingModes,resolve,models,provider,selectedModel,modelLabel,isBuiltIn,platforms,route,candidates};
  if(typeof module==='object') module.exports=api; else root.ChatConfig=api;
})(globalThis);
