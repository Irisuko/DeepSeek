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
  const presets={
    deepseek:['deepseek-flash','deepseek-v4-pro'],
    go:['deepseek-v4.1-flash'],
    zen:['gpt-6-astra','gpt-5.6-sol','claude-fable-5-1','deepseek-v4-flash'],
    openai:['gpt-6-astra','gpt-5.6-sol'],
    anthropic:['claude-fable-5-1'],
  };
  const labels={
    'deepseek-flash':'DeepSeek Flash','deepseek-v4-pro':'DeepSeek V4 Pro',
    'deepseek-v4.1-flash':'DeepSeek V4.1 Flash','deepseek-v4-flash':'DeepSeek V4 Flash',
    'gpt-6-astra':'GPT 6 Astra','gpt-5.6-sol':'GPT 5.6 Sol','claude-fable-5-1':'Claude Fable 5.1',
  };
  function provider(baseUrl){
    const url=new URL(baseUrl);
    if(url.hostname==='opencode.ai') return /^[/]zen[/]go(?:[/]|$)/.test(url.pathname)?'go':'zen';
    return {'api.deepseek.com':'deepseek','api.openai.com':'openai','api.anthropic.com':'anthropic'}[url.hostname]||'custom';
  }
  function presetModels(config){return [...(presets[provider(config.baseUrl)]||[])];}
  function selectedModel(config, previousBaseUrl){
    const list=presetModels(config);
    if(!list.length||list.includes(config.model))return config.model;
    if(previousBaseUrl&&provider(previousBaseUrl)!==provider(config.baseUrl))return list[0];
    if((config.modelProfiles||[]).some(p=>p.model===config.model))return config.model;
    const oldPresets=['gpt-5.4','claude-opus-4-8','claude-sonnet-4-6',...Object.values(presets).flat()];
    return !config.model||oldPresets.includes(config.model)?list[0]:config.model;
  }
  function models(config){
    return [...new Set([...presetModels(config),...(config.modelProfiles||[]).map(p=>p.model),selectedModel(config)].filter(Boolean))];
  }
  function modelLabel(id){return labels[id]||id;}
  const api={protocols,thinkingModes,resolve,models,provider,presetModels,selectedModel,modelLabel};
  if(typeof module==='object') module.exports=api; else root.ChatConfig=api;
})(globalThis);
