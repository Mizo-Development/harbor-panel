// Bundle external dependencies into your production plugin entry.
module.exports={
 activate(context){
  context.registerRoute({method:'GET',path:'/hello',admin:false,async handler({user}){return {message:`Hello from your plugin, ${user.id}!`};}});
  context.registerPage({id:'hello',area:'customer',label:'Hello Harbor',path:'/extensions/hello-world/hello'});
  context.on('invoice.paid',async({invoiceId})=>context.log(`Payment recorded for invoice ${invoiceId}`));
  context.log('Hello Harbor activated');
 }
};
