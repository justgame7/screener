if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}
(function(){
  var dp=null,b=document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();dp=e;b.hidden=false});
  b.addEventListener('click',async function(){if(!dp)return;dp.prompt();await dp.userChoice;dp=null;b.hidden=true});
  window.addEventListener('appinstalled',function(){b.hidden=true});
})();
