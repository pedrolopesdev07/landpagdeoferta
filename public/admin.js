let content, dirty=false;
let csrfToken = '';
let uploadSettings = {};
const $=s=>document.querySelector(s);
async function api(path, data) {
  if (data !== undefined && !csrfToken) {
    const session = await api('session');
    csrfToken = session.csrf_token;
  }
  const options = data === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(data),
  };
  const response = await fetch('/api/' + path, options);
  const value = await response.json();
  if (path === 'session' && response.ok) {
    csrfToken = value.csrf_token;
    uploadSettings = value;
  }
  if (!response.ok) {
    if (response.status === 403) csrfToken = '';
    throw Error(value.error || 'Não foi possível concluir a operação.');
  }
  return value;
}
async function uploadImage(file) {
  if (!csrfToken) await api('session');
  let source = file;
  if (uploadSettings.upload_format === 'png') {
    const bitmap = await createImageBitmap(file);
    try {
      const side = uploadSettings.upload_max_side;
      const ratio = Math.min(1, side / bitmap.width, side / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      source = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Não foi possível preparar a imagem.')), 'image/png'));
    } finally { bitmap.close(); }
  }
  const encoded = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(source);
  });
  return api('upload', { data: encoded });
}
async function load(){content=await api('content');content.offers??=structuredClone(window.OFFERS||[]);content.reviews??=[];$('#login').hidden=true;$('#dashboard').hidden=false;for(const key of ['name','headline','description']){$('#'+key).value=content.settings[key];$('#'+key).oninput=()=>{content.settings[key]=$('#'+key).value;dirty=true;};}draw();drawExtras();}
function draw(){$('#editors').replaceChildren(...content.groups.map((g,i)=>{const card=document.createElement('section');card.className='panel';const heading=document.createElement('h2');heading.textContent=`Grupo ${i+1}`;card.append(heading);for(const [key,title] of [['name','Nome'],['category','Categoria'],['description','Descrição'],['icon','Emoji'],['color','Cor'],['url','Link de convite']]){const label=document.createElement('label');label.textContent=title;const input=document.createElement(key==='color'?'select':'input');if(key==='color')for(const [v,t] of [['sage','Verde'],['peach','Pêssego'],['lavender','Lilás'],['rose','Rosa'],['yellow','Amarelo'],['blue','Azul']]){const option=document.createElement('option');option.value=v;option.textContent=t;input.append(option);}else input.maxLength=500;input.value=g[key];input.oninput=()=>{g[key]=input.value;dirty=true;};label.append(input);card.append(label);}drawGroupDetails(card,g);for(const [title,action] of [['↑ Subir',()=>{if(i)[content.groups[i-1],content.groups[i]]=[g,content.groups[i-1]];}],['↓ Descer',()=>{if(i<content.groups.length-1)[content.groups[i+1],content.groups[i]]=[g,content.groups[i+1]];}],['Excluir',()=>{if(confirm('Excluir este grupo?'))content.groups.splice(i,1);}]]){const b=document.createElement('button');b.textContent=title;b.onclick=()=>{action();dirty=true;draw();};card.append(b);}return card;}));}
$('#login').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('#password').value});$('#password').value='';await load();}catch(e){$('#error').textContent=e.message;}};
$('#add').onclick=()=>{content.groups.push({name:'Novo grupo',category:'Comunidade',description:'',icon:'💬',color:'sage',url:''});dirty=true;draw();};
$('#save').onclick=async()=>{$('#save').disabled=true;try{await api('content',content);dirty=false;$('#status').textContent='Alterações salvas. Sua página já está atualizada!';}catch(e){$('#status').textContent=e.message;}finally{$('#save').disabled=false;}};
$('#logout').onclick=async()=>{if(dirty&&!confirm('Sair sem salvar?'))return;await api('logout',{});dirty=false;location.reload();};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
api('session').then(s=>{if(s.authenticated)return load();}).catch(()=>{$('#error').textContent='Inicie o servidor conforme as instruções do README para usar o painel.';});
