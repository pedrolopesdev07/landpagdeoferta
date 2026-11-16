function drawGroupDetails(card, group) {
  const title = document.createElement('h3'); title.textContent = 'Prévia e vagas do grupo'; card.append(title);
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = 'Envie a foto real do grupo. Informe participantes e capacidade para exibir a ocupação; sem esses valores, nenhum percentual é publicado.'; card.append(hint);
  if (group.photo_url) {
    const photo = document.createElement('img'); photo.src = group.photo_url; photo.alt = 'Foto do grupo';
    photo.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:50%;margin:14px 0'; card.append(photo);
  }
  const imageLabel = document.createElement('label'); imageLabel.textContent = 'Foto do grupo (PNG, JPG ou WebP, até 5 MB)';
  const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp';
  upload.onchange = async () => {
    const file = upload.files[0]; if (!file) return;
    if (file.size > 5000000) { $('#status').textContent = 'A foto deve ter até 5 MB.'; return; }
    upload.disabled = true;
    try {
      const result = await uploadImage(file); group.photo_url = result.url; dirty = true; draw();
      $('#status').textContent = 'Foto enviada. Salve as alterações para atualizar a página.';
    } catch (error) { $('#status').textContent = error.message; }
    finally { upload.disabled = false; }
  };
  imageLabel.append(upload); card.append(imageLabel);
  for (const [key, text] of [['photo_url', 'URL da foto (opcional)'], ['member_count', 'Quantidade atual de participantes'], ['capacity', 'Capacidade total do grupo']]) {
    const label = document.createElement('label'); label.textContent = text;
    const input = document.createElement('input'); input.value = group[key] ?? '';
    if (key !== 'photo_url') { input.type = 'number'; input.min = key === 'capacity' ? '1' : '0'; input.max = '1000000'; input.step = '1'; input.placeholder = 'Não informado'; }
    else { input.maxLength = 2000; input.placeholder = 'https://… ou /uploads/…'; }
    input.oninput = () => { group[key] = key === 'photo_url' ? input.value : input.value === '' ? null : Number(input.value); dirty = true; };
    label.append(input); card.append(label);
  }
}
