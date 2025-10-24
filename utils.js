// =================================================================================
// ARQUIVO: utils.js (REFATORADO)
// RESPONSABILIDADE: Funções pequenas e reutilizáveis (helpers).
// ATUALIZAÇÃO: Adicionada a função getStatusBadge (movida de ui.js).
// =================================================================================

export const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
export const formatTime = (timeString) => timeString || '';
export const formatText = (text) => text ? text.replace(/</g, "&lt;").replace(/>/g, "&gt;") : 'Não informado';
export const formatPeriodo = (start, end) => {
    if (start && end) return `de ${formatDate(start)} a ${formatDate(end)}`;
    if (start) return `a partir de ${formatDate(start)}`;
    if (end) return `até ${formatDate(end)}`;
    return 'Não informado';
}

export const showToast = (message) => {
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;
    document.getElementById('toast-notification').classList.add('show');
    setTimeout(() => document.getElementById('toast-notification').classList.remove('show'), 3000);
};

export const openModal = (modalElement) => {
    modalElement.classList.remove('hidden');
    setTimeout(() => {
        modalElement.classList.remove('opacity-0');
        modalElement.firstElementChild.classList.remove('scale-95', 'opacity-0');
    }, 10);
};

export const closeModal = (modalElement) => {
    if (!modalElement) return;
    modalElement.classList.add('opacity-0');
    modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modalElement.classList.add('hidden'), 300);
};

/**
 * NOVO: (Movido de ui.js)
 * Retorna o HTML para um selo (badge) de status.
 * @param {string} status - O status ('Pendente', 'Finalizada', 'Aguardando Contato', etc.)
 * @returns {string} HTML do selo de status.
 */
export const getStatusBadge = (status) => {
    const statusMap = {
        'Pendente': 'bg-yellow-100 text-yellow-800',
        'Aguardando Contato': 'bg-blue-100 text-blue-800',
        'Finalizada': 'bg-green-100 text-green-800',
        'Resolvido': 'bg-green-100 text-green-800',
        'Cancelado': 'bg-gray-100 text-gray-800'
    };
    const colorClasses = statusMap[status] || 'bg-gray-100 text-gray-800';
    return `<span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${colorClasses}">${status || 'N/A'}</span>`;
};


export const enhanceTextForSharing = (title, text) => {
    // ... (função inalterada)
    let enhancedText = text;
    if (title.toLowerCase().includes('ocorrência')) enhancedText = `*📢 NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR 📢*\n\n${text}`;
    else if (title.toLowerCase().includes('relatório')) enhancedText = `*📋 RELATÓRIO DE OCORRÊNCIAS 📋*\n\n${text}`;
    else if (title.toLowerCase().includes('ficha')) enhancedText = `*📈 FICHA DE ACOMPANHAMENTO 📈*\n\n${text}`;
    enhancedText = enhancedText.replace(/Aos Responsáveis/g, '👥 Aos Responsáveis');
    enhancedText = enhancedText.replace(/Aluno\(a\):/g, '👤 Aluno(a):');
    enhancedText = enhancedText.replace(/Turma:/g, '🏫 Turma:');
    enhancedText = enhancedText.replace(/Data:/g, '🗓️ Data:');
    enhancedText = enhancedText.replace(/Horário:/g, '⏰ Horário:');
    enhancedText = enhancedText.replace(/Descrição:/g, '📝 Descrição:');
    enhancedText = enhancedText.replace(/Providências da Escola:/g, '🏛️ Providências da Escola:');
    enhancedText = enhancedText.replace(/Providências da Família:/g, '👨‍👩‍👧‍👦 Providências da Família:');
    enhancedText += `\n\n-------------\n_Mensagem enviada pelo Sistema de Acompanhamento Pedagógico._`;
    return enhancedText;
};

export const shareContent = async (title, text) => {
    // ... (função inalterada)
    const enhancedText = enhanceTextForSharing(title, text);
    if (navigator.share) {
        try {
            await navigator.share({ title, text: enhancedText });
        } catch (error) {
            console.error('Erro ao partilhar:', error);
            showToast('Erro ao partilhar o conteúdo.');
        }
    } else {
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(enhancedText)}`;
        window.open(whatsappUrl, '_blank');
    }
};

export const loadScript = (url) => {
  // ... (função inalterada)
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      return resolve();
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar o script: ${url}`));
    document.body.appendChild(script);
  });
};
