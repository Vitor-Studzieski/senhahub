const PRINT_JOB_CREATED_EVENT='print_job.available';
class PrintRealtimeSignal {
  constructor({client,url,key,topic,onSignal=()=>{},logger,random=Math.random}={}) {
    Object.assign(this,{client,url,key,topic,onSignal,logger,random});this.stopped=true;this.connected=false;this.failures=0;
  }
  get enabled(){return Boolean(this.client&&this.topic);}
  isConnected(){return this.connected;}
  async start(){if(!this.enabled)return false;this.stopped=false;try{await this.connect()}catch{this.reconnect()}return true;}
  async connect(){
    if(this.stopped)return;
    const previous=this.channel;this.channel=null;this.connected=false;clearTimeout(this.timer);this.timer=null;
    if(previous)await this.client.removeChannel(previous);
    const {data,error}=await this.client.auth.getSession();
    if(error||!data.session)throw new Error('Sessao Realtime indisponivel');
    await this.client.realtime.setAuth(data.session.access_token);
    const channel=this.client.channel(this.topic,{config:{private:true,broadcast:{ack:false,self:false},presence:{enabled:false}}});
    this.channel=channel;
    channel.on('broadcast',{event:PRINT_JOB_CREATED_EVENT},()=>this.onSignal()).subscribe(status=>{
      if(this.stopped||this.channel!==channel)return;
      this.connected=status==='SUBSCRIBED';
      if(this.connected){this.failures=0;this.logger?.info('Canal privado conectado.');this.onSignal();}
      else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))this.reconnect();
    });
  }
  reconnect(){
    if(this.stopped||this.timer)return;
    const delay=Math.min(300000,5000*2**Math.min(this.failures++,6))*(0.75+this.random()/2);
    this.timer=setTimeout(()=>{this.timer=null;this.connect().catch(()=>this.reconnect());},delay);
  }
  async stop(){this.stopped=true;this.connected=false;clearTimeout(this.timer);if(this.channel)await this.client.removeChannel(this.channel);}
}
// Same wake interface on local backends; stream authentication never uses URL tokens.
class PrintSseSignal {
  constructor({apiUrl,token,onSignal,signal}){Object.assign(this,{apiUrl,token,onSignal,signal});this.controller=new AbortController();}
  async start(){this.task=this.run();return true;}
  async run(){
    let failures=0;const signal=AbortSignal.any([this.signal,this.controller.signal]);
    while(!signal.aborted){
      try{
        const response=await fetch(`${this.apiUrl}/api/print/v2/events`,{headers:{authorization:`Bearer ${await this.token()}`},signal});
        if(!response.ok)throw new Error('SSE unavailable');
        let buffer='';const decoder=new TextDecoder();
        for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let at;while((at=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,at);buffer=buffer.slice(at+2);if(event.includes('event: ready')||event.includes('event: print_job.available')){failures=0;this.onSignal();}}}
      }catch{if(signal.aborted)break;}
      await require('node:timers/promises').setTimeout(Math.min(300000,5000*2**Math.min(failures++,6))*(0.75+Math.random()/2),null,{signal}).catch(()=>{});
    }
  }
  async stop(){this.controller.abort();await this.task;}
}
module.exports={PrintRealtimeSignal,PrintSseSignal,PRINT_JOB_CREATED_EVENT};
