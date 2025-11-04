// =================================================================================
// ARQUIVO: main.js (REFATORADO)
// RESPONSABILIDADE: Ponto de entrada, autenticação, gerenciamento de estado
// de alto nível (troca de abas) e inicialização dos módulos de funcionalidade.
//
// ATUALIZAÇÃO (Híbrida Admin):
// 1. Adicionada constante 'SUPER_ADMIN_EMAILS' para o(s) dono(s) da aplicação.
// 2. Lógica de 'onAuthStateChanged' modificada para verificar SUPER_ADMIN_EMAILS
//    OU a lista de emails admin vinda da base de dados (state.config.adminEmails).
// 3. Lógica de 'switchTab' corrigida para garantir a exibição correta das abas.
//
// ATUALIZAÇÃO (IMPRESSÃO - CORREÇÃO MOBILE):
// 1. A chamada window.print() foi envolvida em um setTimeout(..., 0).
// 2. Isso corrige um bug em navegadores mobile (race condition) onde a
//    janela de impressão era chamada ANTES do navegador aplicar a classe
//    'printing-now', resultando em uma página em branco.
//
// ATUALIZAÇÃO (RESET DE AÇÃO - 01/11/2025):
// 1. Importada a `occurrenceStepLogic` do logic.js.
// 2. Importada a `updateRecordWithHistory` do firestore.js.
// 3. A função `handleDeleteConfirmation` foi atualizada para lidar com
//    o novo tipo de ação 'occurrence-reset', permitindo o rollback de etapas.
//
// ATUALIZAÇÃO (PDF V3 - "PDF INTELIGENTE"):
// 1. A função `handlePdfDownload` foi reescrita para usar a lógica de "PDF Inteligente".
// 2. Ela agora detecta o tipo de relatório (Simples vs. Complexo).
// 3. Para relatórios complexos (com 'pdf-card'), ela captura cada card
//    individualmente e gerencia as quebras de página para evitar cortes.
// 4. Ela força a largura do "notebook" na captura, resolvendo a
//    inconsistência de 2 páginas vs. 4 páginas entre dispositivos.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, loadScript } from './utils.js';
// (NOVO - Reset) Importa updateRecordWithHistory
import { loadStudents, loadSchoolConfig, getCollectionRef, deleteRecord, updateRecordWithHistory } from './firestore.js';

// Módulos de Funcionalidade
import { initAuthListeners } from './auth.js';
import { initSettingsListeners } from './settings.js';
import { initStudentListeners } from './students.js';
import { initOccurrenceListeners, renderOccurrences } from './occurrence.js'; // Novo
import { initAbsenceListeners, renderAbsences } from './absence.js';     // Novo

// Módulos de UI e Lógica (agora menores)
import { render } from './ui.js';
// (NOVO - Reset) Importa a lógica de reset
import { occurrenceStepLogic } from './logic.js';

// (ADICIONADO - Híbrida Admin) Lista de Super Administradores (Chave-Mestra)
// Estes emails TÊM SEMPRE acesso de admin, independentemente do que está na base de dados.
const SUPER_ADMIN_EMAILS = [
    'silviobaiajr@gmail.com' // Email do dono da aplicação
];

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences();
    state.db = db;

    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            state.userEmail = user.email;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            try {
                await loadSchoolConfig(); // Carrega state.config (incluindo state.config.adminEmails)
                await loadStudents();
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
                
                // (MODIFICADO - Híbrida Admin) Lógica de verificação de Admin
                const dbAdminList = state.config.adminEmails || []; // Lista de admins da base de dados
                state.isAdmin = SUPER_ADMIN_EMAILS.includes(user.email) || dbAdminList.includes(user.email);
                
                setupFirestoreListeners();
                render(); // Chama o render principal
                
                // (ADICIONADO - Lógica de visibilidade dos botões de Admin)
                if (state.isAdmin) {
                    if(dom.settingsBtn) dom.settingsBtn.classList.remove('hidden');
                    if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.remove('hidden');
                } else {
                    if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
                    if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
                }
                
            } catch (error) {
                showToast(error.message);
            }
        } else {
            state.userId = null; state.userEmail = null; state.students = []; state.occurrences = []; state.absences = [];
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            
            // (ADICIONADO - Híbrida Admin) Garante que os botões de admin fiquem escondidos
            if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
            if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
            
            render();
        }
    });

    setupEventListeners();
});

// --- SINCRONIZAÇÃO COM O BANCO DE DADOS (FIRESTORE) ---

function setupFirestoreListeners() {
    if (!state.userId) return;

    // Listener de Ocorrências (agora chama renderOccurrences)
    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') renderOccurrences(); // Chama o render específico
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    // Listener de Busca Ativa (agora chama renderAbsences)
    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') renderAbsences(); // Chama o render específico
    }, (error) => console.error("Erro ao buscar ações:", error));
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};

// --- CONFIGURAÇÃO CENTRAL DE EVENTOS DA UI ---

function setupEventListeners() {
    // Autenticação
    initAuthListeners();
    dom.logoutBtn.addEventListener('click', () => signOut(auth));

    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Fechar Modais (Genérico)
    setupModalCloseButtons();

    // --- INICIALIZAÇÃO DOS MÓDULOS DE FUNCIONALIDADE ---
    initSettingsListeners();
    initStudentListeners();
    initOccurrenceListeners(); // NOVO
    initAbsenceListeners();    // NOVO

    // Ações em Modais Genéricos (que permanecem aqui)
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);

    // Listener para fechar menus kebab
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kebab-menu-container')) {
            document.querySelectorAll('.kebab-menu-dropdown').forEach(d => d.classList.add('hidden'));
            document.querySelectorAll('.process-content').forEach(c => {
                if (c.style.maxHeight && c.style.maxHeight !== '0px') {
                    c.style.overflow = 'hidden';
                }
            });
        }
    });
}

// --- HANDLERS E FUNÇÕES AUXILIARES (Genéricos) ---

function getFirestoreErrorMessage(code) {
    switch (code) {
        case 'permission-denied': return "Permissão negada. Verifique as suas credenciais.";
        case 'not-found': return "Documento não encontrado.";
        default: return "Ocorreu um erro na operação com a base de dados.";
    }
}

/**
 * Troca a aba ativa e chama o render principal do ui.js
 * (MODIFICADO - Correção Bug)
 */
function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    
    // (MODIFICADO - Lógica explícita para evitar bugs de 'toggle')
    if (isOccurrences) {
        dom.tabOccurrences.classList.add('tab-active');
        dom.tabAbsences.classList.remove('tab-active');
        dom.tabContentOccurrences.classList.remove('hidden');
        dom.tabContentAbsences.classList.add('hidden');
    } else {
        dom.tabOccurrences.classList.remove('tab-active');
        dom.tabAbsences.classList.add('tab-active');
        dom.tabContentOccurrences.classList.add('hidden');
        dom.tabContentAbsences.classList.remove('hidden');
    }
    
    render(); // O render do ui.js vai decidir qual função específica chamar
}

/**
 * Lida com a confirmação de exclusão (genérico).
 * Esta função é chamada pelos listeners em occurrence.js e absence.js
 * --- (NOVO - Reset) Esta função agora também lida com o RESET de etapas. ---
 */
async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    
    // (NOVO - Reset) Desestruturação expandida para o reset
    const { type, id, recordId, actionToReset, historyAction } = state.recordToDelete;
    
    try {
        if (type === 'occurrence') {
            // Lógica original de exclusão de incidente (inalterada)
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente e todos os registros associados foram excluídos.');

        // --- (NOVO - Reset) Lógica para resetar uma etapa da ocorrência ---
        } else if (type === 'occurrence-reset') {
            const logic = occurrenceStepLogic[actionToReset];
            if (!logic) {
                throw new Error(`Lógica de reset não encontrada para a ação: ${actionToReset}`);
            }

            // 1. Prepara o objeto de atualização (limpa os campos)
            const dataToUpdate = {};
            for (const field of logic.fieldsToClear) {
                dataToUpdate[field] = null; // Seta o campo para null
            }
            
            // 2. Define o status para o qual deve reverter
            dataToUpdate.statusIndividual = logic.statusAfterReset;

            // 3. Executa a atualização (usando a função importada)
            // Usa o 'recordId' do state.recordToDelete
            await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
            showToast('Etapa resetada com sucesso.');
        // --- FIM DA NOVIDADE ---
            
        } else if (type === 'absence-cascade') {
            // Lógica original de exclusão em cascata (inalterada)
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) batch.delete(doc(getCollectionRef('absence'), analiseId));
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else {
            // Lógica original de exclusão simples (inalterada)
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) { 
        // (NOVO - Reset) Mensagem de erro genérica
        showToast(type === 'occurrence-reset' ? 'Erro ao resetar a etapa.' : 'Erro ao excluir.'); 
        console.error("Erro na confirmação:", error); 
    } finally { 
        state.recordToDelete = null; 
        closeModal(dom.deleteConfirmModal); 
    }
}


// ==============================================================================
// --- (LÓGICA DE GERAÇÃO DE PDF V3 - "PDF INTELIGENTE") ---
// ==============================================================================

/**
 * Gera um PDF a partir de um elemento HTML e inicia o download.
 * @param {string} contentElementId - O ID do elemento de conteúdo a ser impresso.
 * @param {string} fileName - O nome do arquivo PDF (ex: "Relatorio.pdf").
 * @param {HTMLElement} buttonElement - O botão que foi clicado.
 */
async function handlePdfDownload(contentElementId, fileName, buttonElement) {
    // 1. Verifica se as bibliotecas (de index.html) estão carregadas
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        console.error("jsPDF ou html2canvas não estão carregados.");
        showToast("Erro: Bibliotecas de PDF não carregadas.");
        return;
    }

    const contentElement = document.getElementById(contentElementId);
    if (!contentElement) {
        console.error("Elemento de conteúdo PDF não encontrado:", contentElementId);
        showToast("Erro: Conteúdo para PDF não encontrado.");
        return;
    }

    // Encontra o container do modal que limita a altura e define a largura
    const modalContent = contentElement.closest('.modal-content');
    if (!modalContent) {
        console.error("Erro no PDF: container .modal-content não encontrado.");
        showToast("Erro ao preparar o modal para PDF.");
        return;
    }

    // 2. Define o estado de "Carregando" no botão
    const originalButtonHtml = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Gerando...`;
    showToast("A gerar o seu PDF. Por favor, aguarde...");
    contentElement.scrollTop = 0; // Garante que o scroll esteja no topo

    // 3. Detecta os marcadores que colocamos no reports.js
    const simpleSection = contentElement.querySelector('.pdf-section');
    const headerSection = contentElement.querySelector('.pdf-section-header');
    const cardSections = contentElement.querySelectorAll('.pdf-card');
    const footerSection = contentElement.querySelector('.pdf-section-footer');
    
    // --- (INÍCIO DA LÓGICA V3) ---
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 15; // Margem de 1.5cm
    const usableWidth = pdfWidth - (margin * 2);
    const usableHeight = pdfHeight - (margin * 2);
    let currentY = margin; // Nosso "cursor" vertical na página

    // Helper para adicionar uma imagem (canvas) ao PDF, controlando a quebra de página
    const addCanvasToPdf = (canvas) => {
        const imgHeight = (canvas.height * usableWidth) / canvas.width;
        const pageBreakPadding = 4; // Espaçamento entre os blocos (4mm)

        // Verifica se o bloco cabe na página atual
        // (Se não couber E não estivermos já no topo de uma página nova)
        if (currentY + imgHeight > usableHeight && currentY > margin) {
            pdf.addPage();
            currentY = margin; // Reseta o cursor para o topo da nova página
        }
        
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, currentY, usableWidth, imgHeight);
        currentY += imgHeight + pageBreakPadding; // Move o cursor para baixo
    };

    try {
        // MODO 1: PDF "Inteligente" (para Relatórios com cards)
        if (headerSection || cardSections.length > 0) {
            
            // Força a largura de captura do 'notebook' para consistência
            const captureWidth = modalContent.offsetWidth;
            const options = { 
                scale: 2, 
                useCORS: true, 
                logging: false, 
                width: captureWidth, // Força a largura
                windowWidth: captureWidth, // Garante que o CSS responsivo use a largura forçada
                backgroundColor: '#ffffff'
            };

            // Captura o Cabeçalho (Gráficos, Resumo)
            if (headerSection) {
                const headerCanvas = await html2canvas(headerSection, options);
                addCanvasToPdf(headerCanvas);
            }
            
            // Captura CADA card individualmente
            for (const card of cardSections) {
                const cardCanvas = await html2canvas(card, options);
                addCanvasToPdf(cardCanvas); // O helper cuida da quebra de página
            }
            
            // Captura o Rodapé (Assinatura)
            if (footerSection) {
                const footerCanvas = await html2canvas(footerSection, options);
                addCanvasToPdf(footerCanvas);
            }
        
        // MODO 2: PDF "Simples" (para Atas, Ofícios, Notificações)
        } else if (simpleSection) {
            
            // Prepara o modal para captura total (remove altura máxima e scroll)
            const originalContentOverflow = simpleSection.style.overflowY;
            const originalContentHeight = simpleSection.style.height;
            const originalModalMaxHeight = modalContent.style.maxHeight;

            simpleSection.style.overflowY = 'visible';
            simpleSection.style.height = 'auto';
            modalContent.style.maxHeight = 'none';

            let canvas;
            try {
                canvas = await html2canvas(simpleSection, { 
                    scale: 2, 
                    useCORS: true, 
                    logging: false,
                    backgroundColor: '#ffffff'
                });
            } finally {
                // Restaura os estilos IMEDIATAMENTE após a captura
                simpleSection.style.overflowY = originalContentOverflow;
                simpleSection.style.height = originalContentHeight;
                modalContent.style.maxHeight = originalModalMaxHeight;
            }

            // Lógica V2 (corte de página para imagem única)
            const imgHeight = (canvas.height * usableWidth) / canvas.width;
            let heightLeft = imgHeight;
            let position = margin;
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, position, usableWidth, imgHeight);
            heightLeft -= (usableHeight);
            
            while (heightLeft > 0) {
                position = -heightLeft + margin; // Puxa a imagem para cima
                pdf.addPage();
                pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, position, usableWidth, imgHeight);
                heightLeft -= usableHeight;
            }

        } else {
            throw new Error("Nenhum conteúdo marcadopara PDF (.pdf-section ou .pdf-card) foi encontrado.");
        }

        // 8. Salva o PDF (inicia o download)
        pdf.save(fileName);
        showToast("PDF gerado com sucesso!");

    } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        showToast("Erro ao gerar o PDF. Verifique a consola.");
    } finally {
        // 9. Restaura o botão ao estado original
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalButtonHtml;
    }
}


// --- CONFIGURAÇÃO DE LISTENERS DINÂMICOS ---

function setupModalCloseButtons() {
    // (Esta função permanece inalterada, pois lida com TODOS os modais)
    const modalMap = {
        'close-modal-btn': dom.occurrenceModal, 'cancel-btn': dom.occurrenceModal,
        'close-absence-modal-btn': dom.absenceModal, 'cancel-absence-btn': dom.absenceModal,
        'close-report-generator-btn': dom.reportGeneratorModal, 'cancel-report-generator-btn': dom.reportGeneratorModal,
        'close-notification-btn': dom.notificationModalBackdrop,
        'close-student-selection-modal-btn': document.getElementById('student-selection-modal'),
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': document.getElementById('history-view-modal-backdrop'),
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal,
        'close-settings-modal-btn': dom.settingsModal,
        'cancel-settings-btn': dom.settingsModal,
        'close-follow-up-modal-btn': dom.followUpModal,
        'cancel-follow-up-btn': dom.followUpModal,
        // (NOVO) Modais do fluxo Enviar ao CT
        'close-send-ct-modal-btn': dom.sendOccurrenceCtModal,
        'cancel-send-ct-modal-btn': dom.sendOccurrenceCtModal,
    };
    
    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            // Remove listener antigo para evitar duplicatas
            const oldListener = button.__clickListener;
            if (oldListener) button.removeEventListener('click', oldListener);
            
            // Adiciona novo listener
            const newListener = () => closeModal(modal);
            button.addEventListener('click', newListener);
            button.__clickListener = newListener; // Armazena referência para remoção futura
            
            if (button.hasAttribute('onclick')) button.removeAttribute('onclick');
        }
    }
    
    // --- ATUALIZAÇÃO DOS BOTÕES DE SHARE E PRINT ---
    
    // Botões de Share (Partilhar) - (Sem alteração)
    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));

    // (MODIFICADO - GERAÇÃO DE PDF)
    // Altera o texto dos botões e atribui a nova função 'handlePdfDownload'

    // Remove listeners antigos para evitar chamadas duplicadas
    const cleanAndSetListener = (buttonId, contentId, fileName) => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.innerHTML = '<i class="fas fa-file-pdf mr-2"></i>Baixar PDF';
            
            // Clonamos o botão para remover TODOS os event listeners antigos
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Adicionamos o novo listener
            newButton.addEventListener('click', (e) => handlePdfDownload(contentId, fileName, e.currentTarget));
        }
    };

    cleanAndSetListener('print-btn', 'notification-content', 'Notificacao.pdf');
    cleanAndSetListener('report-print-btn', 'report-view-content', 'Relatorio.pdf');
    cleanAndSetListener('ficha-print-btn', 'ficha-view-content', 'Ficha.pdf');
}

