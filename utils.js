// ARQUIVO: utils.js
// Responsabilidade: Funções pequenas e reutilizáveis (helpers).
//
// CORREÇÃO (23/10/2025): A função formatText foi atualizada para
// ser mais robusta e evitar erros quando recebe valores
// diferentes de string (como null ou undefined).

export const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
export const formatTime = (timeString) => timeString || '';

/**
 * Formata um texto para exibição segura em HTML e garante que
 * valores null/undefined sejam tratados corretamente.
 * @param {*} text - O valor a ser formatado. Pode ser string, null, undefined, etc.
 * @returns {string} - O texto formatado ou 'Não informado'.
 */
export const formatText = (text) => {
    // 1. Verifica se o texto é null, undefined ou explicitamente vazio.
    if (text == null || text === '') {
        return 'Não informado';
    }
    // 2. Converte explicitamente para string para garantir que .replace funcione.
    const textAsString = String(text);
    // 3. Escapa caracteres HTML.
    return textAsString.replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

export const formatPeriodo = (start, end) => {
    if (start && end) return `de ${formatDate(start)} a ${formatDate(end)}`;
    if (start) return `a partir de ${formatDate(start)}`;
    if (end) return `até ${formatDate(end)}`;
    return 'Não informado';
};

export const showToast = (message) => {
    const toastMessage = document.getElementById('toast-message');
    if (!toastMessage) {
        console.warn('Elemento toast-message não encontrado!');
        return;
    }
    toastMessage.textContent = message;
    const toastNotification = document.getElementById('toast-notification');
     if (!toastNotification) {
        console.warn('Elemento toast-notification não encontrado!');
        return;
    }
    toastNotification.classList.add('show');
    // Garante que a remoção ocorra mesmo se houver múltiplos toasts rápidos
    setTimeout(() => {
        if (toastMessage.textContent === message) { // Só remove se a mensagem ainda for a mesma
            toastNotification.classList.remove('show');
        }
    }, 3000);
};


export const openModal = (modalElement) => {
    if (!modalElement || !modalElement.classList) {
        console.warn('Tentativa de abrir um modal inválido:', modalElement);
        return;
    }
    modalElement.classList.remove('hidden');
    setTimeout(() => {
        modalElement.classList.remove('opacity-0');
        // Verifica se o firstElementChild existe antes de acessar classList
        if (modalElement.firstElementChild && modalElement.firstElementChild.classList) {
             modalElement.firstElementChild.classList.remove('scale-95', 'opacity-0');
        } else {
             console.warn('Modal não possui um firstElementChild válido para animar:', modalElement);
        }
    }, 10); // Pequeno delay para garantir a transição CSS
};


export const closeModal = (modalElement) => {
    if (!modalElement || !modalElement.classList) {
         console.warn('Tentativa de fechar um modal inválido:', modalElement);
        return;
    }
    modalElement.classList.add('opacity-0');
    // Verifica se o firstElementChild existe
    if (modalElement.firstElementChild && modalElement.firstElementChild.classList) {
        modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalElement.classList.add('hidden'), 300); // Tempo da transição CSS
};


export const enhanceTextForSharing = (title, text) => {
    let enhancedText = text;

    if (title.toLowerCase().includes('ocorrência')) {
        enhancedText = `*📢 NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR 📢*\n\n${text}`;
    } else if (title.toLowerCase().includes('relatório')) {
        enhancedText = `*📋 RELATÓRIO DE OCORRÊNCIAS 📋*\n\n${text}`;
    } else if (title.toLowerCase().includes('ficha')) {
        enhancedText = `*📈 FICHA DE ACOMPANHAMENTO 📈*\n\n${text}`;
    }

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
    const enhancedText = enhanceTextForSharing(title, text);
    if (navigator.share) {
        try {
            await navigator.share({ title, text: enhancedText });
        } catch (error) {
            // Ignora o erro AbortError que ocorre se o usuário fechar a janela de compartilhamento
            if (error.name !== 'AbortError') {
                 console.error('Erro ao partilhar:', error);
                 showToast('Erro ao partilhar o conteúdo.');
            }
        }
    } else {
        // Fallback para WhatsApp ou copiar para área de transferência se o share API não estiver disponível
        try {
            await navigator.clipboard.writeText(enhancedText);
            showToast('Conteúdo copiado! Cole no WhatsApp ou onde desejar.');
        } catch (err) {
             console.error('Falha ao copiar:', err);
             // Fallback final: Abrir link do WhatsApp
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(enhancedText)}`;
            window.open(whatsappUrl, '_blank');
        }
    }
};
