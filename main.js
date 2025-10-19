
/* ============================================================================== */
/* ARQUIVO: main.js                                                               */
/* TODO O SEU CÓDIGO DE LÓGICA (JAVASCRIPT) ESTÁ AQUI                             */
/* ============================================================================== */

// Importa as funções necessárias das bibliotecas do Firebase.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, setDoc, deleteDoc, onSnapshot, collection, serverTimestamp, query, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ************************************************************************************
// CONFIGURAÇÃO DO FIREBASE
// ************************************************************************************
const firebaseConfig = {
    apiKey: "AIzaSyCDWtwnD_3V9En9qEEYtlP_dpOTvt-P9ks",
    authDomain: "acompanhamento-vida-escolar.firebaseapp.com",
    projectId: "acompanhamento-vida-escolar",
    storageBucket: "acompanhamento-vida-escolar.appspot.com",
    messagingSenderId: "315669308837",
    appId: "1:315669308837:web:053497df9ceea4df5c4c9c"
};
// ************************************************************************************

const config = {
    schoolName: "EMEF. DILMA DOS SANTOS CARVALHO",
    city: "Cidade (Exemplo)"
};

const state = {
    students: [],
    occurrences: [],
    absences: [],
    filterOccurrences: '',
    filtersOccurrences: { startDate: null, endDate: null },
    filterAbsences: '',
    filtersAbsences: { 
        processStatus: 'all', 
        pendingAction: 'all', 
        returnStatus: 'all' 
    },
    activeTab: 'occurrences',
    recordToDelete: null,
    db: null,
    userId: null,
    unsubscribeOccurrences: null,
    unsubscribeAbsences: null
};

const dom = {
    loginScreen: document.getElementById('login-screen'),
    mainContent: document.getElementById('main-content'),
    loginView: document.getElementById('login-view'),
    registerView: document.getElementById('register-view'),
    showRegisterViewBtn: document.getElementById('show-register-view'),
    showLoginViewBtn: document.getElementById('show-login-view'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    logoutBtn: document.getElementById('logout-btn'),
    userProfile: document.getElementById('user-profile'),
    userEmail: document.getElementById('user-email'),
    occurrenceModal: document.getElementById('occurrence-modal'),
    absenceModal: document.getElementById('absence-modal'),
    studentsModal: document.getElementById('students-modal'),
    notificationModalBackdrop: document.getElementById('notification-modal-backdrop'),
    deleteConfirmModal: document.getElementById('delete-confirm-modal'),
    reportGeneratorModal: document.getElementById('report-generator-modal'),
    reportViewModalBackdrop: document.getElementById('report-view-modal-backdrop'),
    fichaViewModalBackdrop: document.getElementById('ficha-view-modal-backdrop'),
    occurrencesListDiv: document.getElementById('occurrences-list'),
    absencesListDiv: document.getElementById('absences-list'),
    emptyStateOccurrences: document.getElementById('empty-state-occurrences'),
    emptyStateAbsences: document.getElementById('empty-state-absences'),
    loadingOccurrences: document.getElementById('loading-occurrences'),
    loadingAbsences: document.getElementById('loading-absences'),
    occurrenceForm: document.getElementById('occurrence-form'),
    absenceForm: document.getElementById('absence-form'),
    tabOccurrences: document.getElementById('tab-occurrences'),
    tabAbsences: document.getElementById('tab-absences'),
    tabContentOccurrences: document.getElementById('tab-content-occurrences'),
    tabContentAbsences: document.getElementById('tab-content-absences'),
    searchOccurrences: document.getElementById('search-occurrences'),
    searchAbsences: document.getElementById('search-absences'),
    occurrencesTitle: document.getElementById('occurrences-title'),
    occurrenceStartDate: document.getElementById('occurrence-start-date'),
    occurrenceEndDate: document.getElementById('occurrence-end-date'),
};

const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
const formatTime = (timeString) => timeString || '';
const formatText = (text) => text ? text.replace(/</g, "&lt;").replace(/>/g, "&gt;") : 'Não informado';
const formatPeriodo = (start, end) => {
    if (start && end) return `de ${formatDate(start)} a ${formatDate(end)}`;
    if (start) return `a partir de ${formatDate(start)}`;
    if (end) return `até ${formatDate(end)}`;
    return 'Não informado';
}

const showToast = (message) => {
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;
    document.getElementById('toast-notification').classList.add('show');
    setTimeout(() => document.getElementById('toast-notification').classList.remove('show'), 3000);
};

const openModal = (modalElement) => {
    modalElement.classList.remove('hidden');
    setTimeout(() => {
        modalElement.classList.remove('opacity-0');
        modalElement.firstElementChild.classList.remove('scale-95', 'opacity-0');
    }, 10);
};

const closeModal = (modalElement) => {
    if (!modalElement) return;
    modalElement.classList.add('opacity-0');
    modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modalElement.classList.add('hidden'), 300);
};

const enhanceTextForSharing = (title, text) => {
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

const getStudentProcessInfo = (studentId) => {
    const studentActions = state.absences
        .filter(a => a.studentId === studentId)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    let lastAnaliseIndex = -1;
    for (let i = studentActions.length - 1; i >= 0; i--) {
        if (studentActions[i].actionType === 'analise') {
            lastAnaliseIndex = i;
            break;
        }
    }
    
    const currentCycleActions = studentActions.slice(lastAnaliseIndex + 1);
    
    let processId;
    const existingProcessAction = currentCycleActions.find(a => a.processId);

    if (existingProcessAction) {
        processId = existingProcessAction.processId;
    } else {
        const allProcessIdsForStudent = state.absences.filter(a => a.studentId === studentId)
            .map(a => a.processId)
            .filter(Boolean);
        
        const processNumbers = allProcessIdsForStudent
            .map(pid => parseInt(pid.split('-')[1] || 0, 10))
            .filter(num => !isNaN(num));
            
        const maxNumber = processNumbers.length > 0 ? Math.max(...processNumbers) : 0;
        processId = `${studentId}-${maxNumber + 1}`;
    }

    return {
        currentCycleActions,
        processId
    };
};

const determineNextActionForStudent = (studentId) => {
    const { currentCycleActions } = getStudentProcessInfo(studentId);
    const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
    const existingActionTypes = new Set(currentCycleActions.map(a => a.actionType));

    const hasReturnedInCurrentCycle = currentCycleActions.some(
        a => a.contactReturned === 'yes' || a.visitReturned === 'yes' || a.ctReturned === 'yes'
    );

    if (hasReturnedInCurrentCycle && !existingActionTypes.has('analise')) {
        return 'analise';
    }

    for (const action of sequence) {
        if (!existingActionTypes.has(action)) {
            return action;
        }
    }
    
    return 'analise'; // Fallback
};

const shareContent = async (title, text) => {
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

const renderOccurrences = () => {
    dom.loadingOccurrences.classList.add('hidden');
    
    // 1. Filtering
    let filtered = state.occurrences.filter(o => {
        const student = state.students.find(s => s.matricula === o.studentId);
        const nameMatch = student && student.name.toLowerCase().startsWith(state.filterOccurrences.toLowerCase());
        
        if (!nameMatch) return false;

        const { startDate, endDate } = state.filtersOccurrences;
        if (startDate && o.date < startDate) return false;
        if (endDate && o.date > endDate) return false;

        return true;
    });
    
    // Update title with count
    dom.occurrencesTitle.textContent = `Exibindo ${filtered.length} Registro(s) de Ocorrências`;

    if (filtered.length === 0) {
         dom.emptyStateOccurrences.classList.remove('hidden');
         dom.occurrencesListDiv.innerHTML = '';
         return;
    }

    dom.emptyStateOccurrences.classList.add('hidden');

    // 2. Grouping by studentId
    const groupedByStudent = filtered.reduce((acc, occ) => {
        const key = occ.studentId;
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(occ);
        return acc;
    }, {});

    // Sort groups by student name
    const sortedGroupKeys = Object.keys(groupedByStudent).sort((a, b) => {
        const studentA = state.students.find(s => s.matricula === a)?.name || '';
        const studentB = state.students.find(s => s.matricula === b)?.name || '';
        return studentA.localeCompare(studentB);
    });

    // 3. Rendering Accordion
    let html = '';
for (const studentId of sortedGroupKeys) {
const occurrences = groupedByStudent[studentId].sort((a, b) => new Date(b.date) - new Date(a.date));
const student = state.students.find(s => s.matricula === studentId);
if (!student) continue;

html += `
    <div class="border rounded-lg overflow-hidden mb-4 bg-white shadow">
        <div class="process-header bg-gray-50 hover:bg-gray-100 cursor-pointer p-4 flex justify-between items-center" data-student-id-occ="${student.matricula}">
            <div>
                <p class="font-semibold text-gray-800 cursor-pointer hover:underline new-occurrence-from-history-btn" data-student-id="${student.matricula}">${student.name}</p>
                <p class="text-sm text-gray-500">${occurrences.length} Ocorrência(s) registrada(s)</p>
            </div>
            <div class="flex items-center space-x-4">
                <button class="generate-student-report-btn bg-purple-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-purple-700 text-xs no-print" data-student-id="${student.matricula}">
                    <i class="fas fa-file-invoice"></i> Relatório
                </button>
                <i class="fas fa-chevron-down transition-transform duration-300"></i>
            </div>
        </div>
        <div class="process-content" id="content-occ-${student.matricula}">
            <div class="border-t border-gray-200 divide-y divide-gray-200">
                ${occurrences.map(occ => `
                    <div class="flex justify-between items-start py-3 px-4 hover:bg-gray-50 transition-colors duration-150">
                        <div>
                            <p class="font-medium text-gray-800">${occ.occurrenceType || 'N/A'}</p>
                            <p class="text-sm text-gray-500">Data: ${formatDate(occ.date)}</p>
                        </div>
                        <div class="whitespace-nowrap text-right text-sm font-medium space-x-2 flex items-center pl-4">
                            <button class="view-btn text-indigo-600 hover:text-indigo-900 p-1 rounded-full hover:bg-indigo-100" data-id="${occ.id}" title="Ver Notificação"><i class="fas fa-eye"></i></button>
                            <button class="edit-btn text-yellow-600 hover:text-yellow-900 p-1 rounded-full hover:bg-yellow-100" data-id="${occ.id}" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                            <button class="delete-btn text-red-600 hover:text-red-900 p-1 rounded-full hover:bg-red-100" data-id="${occ.id}" title="Excluir"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>
`;
}
    dom.occurrencesListDiv.innerHTML = html;
};

const renderAbsences = () => {
    dom.loadingAbsences.classList.add('hidden');

    const searchFiltered = state.absences
        .filter(a => {
            const student = state.students.find(s => s.matricula === a.studentId);
            return student && student.name.toLowerCase().startsWith(state.filterAbsences.toLowerCase());
        });

    const groupedByProcess = searchFiltered.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`; 
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(action);
        return acc;
    }, {});

    const filteredGroupKeys = Object.keys(groupedByProcess).filter(processId => {
        const actions = groupedByProcess[processId];
        actions.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        
        const { processStatus, pendingAction, returnStatus } = state.filtersAbsences;

        const isConcluded = actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        const lastAction = actions[actions.length - 1];
        if (pendingAction !== 'all') {
            if (isConcluded) return false;

            if (pendingAction === 'pending_contact') {
                const isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
                if (!isPendingContact) return false;
            }
            if (pendingAction === 'pending_feedback') {
                const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');
                const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
                const isPendingFeedback = hasCtAction && !ctAction.ctFeedback;
                if (!isPendingFeedback) return false;
            }
        }

        if (returnStatus !== 'all') {
            const lastActionWithReturnInfo = [...actions].reverse().find(a => 
                (a.contactReturned !== undefined && a.contactReturned !== null) ||
                (a.visitReturned !== undefined && a.visitReturned !== null) ||
                (a.ctReturned !== undefined && a.ctReturned !== null)
            );

            if (!lastActionWithReturnInfo) {
                if (returnStatus === 'returned' || returnStatus === 'not_returned') return false;
            } else {
                const lastStatus = lastActionWithReturnInfo.contactReturned || lastActionWithReturnInfo.visitReturned || lastActionWithReturnInfo.ctReturned;

                if (returnStatus === 'returned' && lastStatus !== 'yes') {
                    return false;
                }
                if (returnStatus === 'not_returned' && lastStatus !== 'no') {
                    return false;
                }
            }
        }
        
        return true;
    });

    if (filteredGroupKeys.length === 0 && state.filterAbsences === '' && state.filtersAbsences.processStatus === 'all' && state.filtersAbsences.pendingAction === 'all' && state.filtersAbsences.returnStatus === 'all') {
        dom.emptyStateAbsences.classList.remove('hidden');
        dom.absencesListDiv.innerHTML = '';
    } else {
        dom.emptyStateAbsences.classList.add('hidden');
        
        const sortedGroupKeys = filteredGroupKeys.sort((a, b) => {
            const lastActionA = groupedByProcess[a].sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0];
            const lastActionB = groupedByProcess[b].sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0];
            return (lastActionB.createdAt?.seconds || 0) - (lastActionA.createdAt?.seconds || 0);
        });

        let html = '';
        for (const processId of sortedGroupKeys) {
            const actions = groupedByProcess[processId].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
            const firstAction = actions[0];
            const student = state.students.find(s => s.matricula === firstAction.studentId);
            if (!student) continue;

            const isConcluded = actions.some(a => a.actionType === 'analise');
            const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');

            html += `
                <div class="border rounded-lg overflow-hidden mb-4 bg-white shadow">
                    <div class="process-header bg-gray-50 hover:bg-gray-100 cursor-pointer p-4 flex justify-between items-center" data-process-id="${processId}">
                        <div>
                            <p class="font-semibold text-gray-800 cursor-pointer hover:underline new-action-from-history-btn" data-student-id="${student.matricula}">${student.name}</p>
                            <p class="text-sm text-gray-500">ID do Processo: ${processId} - Início: ${formatDate(firstAction.createdAt?.toDate())}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">CONCLUÍDO</span>' : ''}
                            <button class="generate-ficha-btn-row bg-purple-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-purple-700 text-xs no-print" data-student-id="${student.matricula}" data-process-id="${processId}">
                                <i class="fas fa-file-invoice"></i> Ficha
                            </button>
                            <i class="fas fa-chevron-down transition-transform duration-300"></i>
                        </div>
                    </div>
                    <div class="process-content" id="content-${processId}">
                        <div class="p-4 border-t border-gray-200">
                            <div class="space-y-4">
        `;
        
            actions.forEach(abs => {
                const actionDate = abs.contactDate || abs.visitDate || abs.ctSentDate || (abs.createdAt?.toDate() ? abs.createdAt.toDate().toISOString().split('T')[0] : '');
                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';

                
                let actionButtonHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    actionButtonHtml = `<button class="notification-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-1 px-2 rounded-md bg-indigo-50" data-id="${abs.id}" title="Gerar Notificação">Notificação</button>`;
                } else if (abs.actionType === 'visita') {
                    const disabled = isConcluded || hasCtAction;
                    actionButtonHtml = `<button class="send-ct-btn text-blue-600 hover:text-blue-900 text-xs font-semibold py-1 px-2 rounded-md bg-blue-50 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" title="${disabled ? 'Encaminhamento já realizado' : 'Enviar ao Conselho Tutelar'}" ${disabled ? 'disabled' : ''}>Enviar ao C.T.</button>`;
                } else if (abs.actionType === 'encaminhamento_ct') {
                     if(abs.oficioNumber) {
                          actionButtonHtml = `<button class="view-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50" data-id="${abs.id}" title="Visualizar Ofício">Ver Ofício</button>`;
                     }
                } else {
                    actionButtonHtml = `<span class="inline-block w-24"></span>`;
                }
                
                let statusHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    statusHtml = (abs.contactSucceeded === 'yes' || abs.contactSucceeded === 'no')
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-check"></i> Contato Realizado</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Contato</p>';
                } else if (abs.actionType === 'visita') {
                     statusHtml = (abs.visitSucceeded === 'yes' || abs.visitSucceeded === 'no')
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-check"></i> Contato Realizado</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Contato</p>';
                } else if (abs.actionType === 'encaminhamento_ct') {
                    statusHtml = abs.ctFeedback 
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-inbox"></i> Devolutiva Recebida</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Devolutiva</p>';
                }

                html += `
                    <div class="flex justify-between items-start border-b last:border-b-0 pb-3">
                        <div>
                            <p class="font-medium text-gray-700">${actionDisplayTitles[abs.actionType] || 'N/A'}</p>
                            <p class="text-sm text-gray-500">Data: ${formatDate(actionDate)}</p>
                            ${returned ? '<p class="text-sm text-green-600 font-semibold mt-1"><i class="fas fa-check-circle"></i> Aluno Retornou</p>' : ''}
                            ${notReturned ? '<p class="text-sm text-red-600 font-semibold mt-1"><i class="fas fa-times-circle"></i> Aluno Não Retornou</p>' : ''}
                            ${statusHtml}
                        </div>
                        <div class="whitespace-nowrap text-right text-sm font-medium space-x-2 flex items-center">
                            ${actionButtonHtml}
                            <button class="edit-absence-btn text-yellow-600 hover:text-yellow-900 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" title="Editar Ação" ${isConcluded ? 'disabled' : ''}><i class="fas fa-pencil-alt fa-lg"></i></button>
                            <button class="delete-absence-btn text-red-600 hover:text-red-900 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" data-action-type="${abs.actionType}" title="Excluir Ação" ${isConcluded ? 'disabled' : ''}><i class="fas fa-trash fa-lg"></i></button>
                        </div>
                    </div>
                `;
            });

            html += `
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
        }
        
        dom.absencesListDiv.innerHTML = html;
    }
};

const render = () => {
    if (state.activeTab === 'occurrences') renderOccurrences();
    else renderAbsences();
};

const getStudentsDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(state.db, `/artifacts/${appId}/public/data/school-data`, 'students');
};

const getCollectionRef = (type) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const collectionName = type === 'occurrence' ? 'occurrences' : 'absences';
    return collection(state.db, `/artifacts/${appId}/public/data/${collectionName}`);
};
const addRecord = (type, data) => addDoc(getCollectionRef(type), { ...data, createdAt: serverTimestamp() });
const updateRecord = (type, id, data) => setDoc(doc(getCollectionRef(type), id), data, { merge: true });
const deleteRecord = (type, id) => deleteDoc(doc(getCollectionRef(type), id));

const setupFirestoreListeners = async () => {
    if (!state.userId) return;

    try {
        const docSnap = await getDoc(getStudentsDocRef());
        if (docSnap.exists() && docSnap.data().list) {
            state.students = docSnap.data().list;
            renderStudentsList();
        } else {
            console.log("Nenhuma lista de alunos encontrada no Firestore.");
        }
    } catch (error) {
        console.error("Erro ao carregar lista de alunos:", error);
        showToast("Erro ao carregar a lista de alunos.");
    }

    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    state.unsubscribeOccurrences = onSnapshot(query(getCollectionRef('occurrence')), (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeAbsences = onSnapshot(query(getCollectionRef('absence')), (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') render();
    }, (error) => console.error("Erro ao buscar ações:", error));
};

const detachFirestoreListeners = () => {
    if (state.unsubscribeOccurrences) {
        state.unsubscribeOccurrences();
        state.unsubscribeOccurrences = null;
    }
    if (state.unsubscribeAbsences) {
        state.unsubscribeAbsences();
        state.unsubscribeAbsences = null;
    }
};

const openNotificationModal = (id) => {
    const data = state.occurrences.find(occ => occ.id === id);
    if (data) {
        const student = state.students.find(s => s.matricula === data.studentId) || {name: 'Aluno Removido', class: 'N/A', resp1: '', resp2: ''};
        document.getElementById('notification-title').innerText = 'Notificação de Ocorrência Escolar';
        const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');
        document.getElementById('notification-content').innerHTML = `
            <div class="space-y-6 text-sm"><div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${config.schoolName}</h2><h3 class="text-lg font-semibold mt-2">NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR</h3></div>
            <div class="pt-4"><p class="mb-2"><strong>Aos Responsáveis (${responsaveis}) pelo(a) aluno(a):</strong></p><p class="text-lg font-semibold">${formatText(student.name)}</p><p class="text-gray-600"><strong>Turma:</strong> ${formatText(student.class)}</p></div>
            <p class="text-justify">Prezados(as), vimos por meio desta notificá-los sobre uma ocorrência disciplinar envolvendo o(a) aluno(a) supracitado(a), registrada em <strong>${formatDate(data.date)}</strong>.</p>
            <div class="border-t pt-4 space-y-4">
                <div><h4 class="font-semibold mb-1">Tipo:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md">${formatText(data.occurrenceType)}</p></div>
                <div><h4 class="font-semibold mb-1">Descrição:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.description)}</p></div>
                <div><h4 class="font-semibold mb-1">Pessoas Envolvidas:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.involved)}</p></div>
                <div><h4 class="font-semibold mb-1">Providências da Escola:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.actionsTakenSchool)}</p></div>
                <div><h4 class="font-semibold mb-1">Providências da Família:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.actionsTakenFamily)}</p></div>
            </div>
            <p class="mt-4 text-justify">Diante do exposto, solicitamos o comparecimento de um responsável na coordenação pedagógica para uma reunião na seguinte data e horário:</p>
            <div class="mt-4 p-3 bg-indigo-100 text-indigo-800 rounded-md text-center font-semibold"><p><strong>Data:</strong> ${formatDate(data.meetingDate) || 'A ser agendada'}</p><p><strong>Horário:</strong> ${formatTime(data.meetingTime) || ''}</p></div>
            <div class="border-t pt-16 mt-16"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1">Ciente do Responsável</p></div></div></div>`;
        openModal(dom.notificationModalBackdrop);
    }
};

const openFichaViewModal = (id) => {
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    const student = state.students.find(s => s.matricula === record.studentId) || {name: 'Aluno Removido', class: 'N/A', endereco: '', resp1: '', resp2: '', contato: ''};
    
    const attemptLabels = { tentativa_1: "primeira", tentativa_2: "segunda", tentativa_3: "terceira" };
    let title = "Notificação de Baixa Frequência";
    
    let body = '';
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');

    switch (record.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            body = `
                <p class="mt-4 text-justify">Prezados(as) Responsáveis, <strong>${responsaveis}</strong>,</p>
                <p class="mt-4 text-justify">
                    Vimos por meio desta notificar que o(a) estudante supracitado(a) acumulou <strong>${formatText(record.absenceCount)} faltas</strong> no período ${formatPeriodo(record.periodoFaltasStart, record.periodoFaltasEnd)}, 
                    configurando baixa frequência escolar. Esta é a <strong>${attemptLabels[record.actionType]} tentativa de contato</strong> realizada pela escola.
                </p>
                <p class="mt-4 text-justify bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                    Ressaltamos que, conforme a Lei de Diretrizes e Bases da Educação Nacional (LDB - Lei 9.394/96) e o Estatuto da Criança e do Adolescente (ECA - Lei 8.069/90), 
                    é dever da família zelar pela frequência do(a) estudante à escola. A persistência das faltas implicará no acionamento do Conselho Tutelar para as devidas providências.
                </p>
                <p class="mt-4 text-justify">
                    Diante do exposto, solicitamos o comparecimento de um(a) responsável na <strong>coordenação pedagógica</strong> desta unidade escolar para tratarmos do assunto na data e horário abaixo:
                </p>
                <div class="mt-4 p-3 bg-gray-100 rounded-md text-center">
                    <p><strong>Data:</strong> ${formatDate(record.meetingDate)}</p>
                    <p><strong>Horário:</strong> ${formatTime(record.meetingTime)}</p>
                </div>
            `;
            break;
        case 'visita':
            title = actionDisplayTitles[record.actionType];
            body = `<p class="mt-4">Notificamos que na data de <strong>${formatDate(record.visitDate)}</strong>, o agente escolar <strong>${formatText(record.visitAgent)}</strong> realizou uma visita domiciliar.</p><p class="mt-2"><strong>Justificativa do responsável:</strong> ${formatText(record.visitReason)}</p>`;
            break;
        default: 
            title = actionDisplayTitles[record.actionType] || 'Documento de Busca Ativa';
            body = `<p class="mt-4">Registro de ação administrativa referente à busca ativa do(a) aluno(a).</p>`; 
            break;
    }

    const contentHTML = `
        <div class="space-y-6 text-sm text-gray-800">
            <div class="text-center border-b pb-4">
                <h2 class="text-lg font-bold uppercase">${config.schoolName}</h2>
                <h3 class="font-semibold mt-1 uppercase">${title}</h3>
            </div>
            <div class="pt-4">
                <p><strong>Aluno(a):</strong> ${student.name}</p>
                <p><strong>Turma:</strong> ${student.class || ''}</p>
                <p><strong>Endereço:</strong> ${formatText(student.endereco)}</p>
                <p><strong>Contato:</strong> ${formatText(student.contato)}</p>
            </div>
            <div class="text-justify">${body}</div>
            <div class="border-t pt-16 mt-16">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Ciente do Responsável</p>
                </div>
            </div>
        </div>`;

    document.getElementById('ficha-view-title').textContent = title;
    document.getElementById('ficha-view-content').innerHTML = contentHTML;
    openModal(dom.fichaViewModalBackdrop);
};

const openReportGeneratorModal = (reportType) => {
    const records = reportType === 'occurrences' ? state.occurrences : state.absences;
    const studentIds = [...new Set(records.map(item => item.studentId))];
    const studentsInRecords = state.students.filter(s => studentIds.includes(s.matricula)).sort((a,b) => a.name.localeCompare(b.name));

    const select = document.getElementById('student-select');
    
    const title = reportType === 'occurrences' ? 'Gerar Relatório de Ocorrências' : 'Gerar Ficha Consolidada';
    document.getElementById('report-generator-title').textContent = title;
    dom.reportGeneratorModal.dataset.reportType = reportType;
    
    select.innerHTML = studentsInRecords.length > 0
        ? '<option value="">Selecione um aluno...</option>' + studentsInRecords.map(s => `<option value="${s.matricula}">${s.name}</option>`).join('')
        : '<option value="">Nenhum aluno com registros</option>';
    openModal(dom.reportGeneratorModal);
};

const generateAndShowOficio = (action, oficioNumber = null) => {
    if (!action) return showToast('Ação de origem não encontrada.');
    
    const finalOficioNumber = oficioNumber || action.oficioNumber;
    const finalOficioYear = action.oficioYear || new Date().getFullYear();

    if (!finalOficioNumber) return showToast('Número do ofício não encontrado para este registro.');

    const student = state.students.find(s => s.matricula === action.studentId);
    if (!student) return showToast('Aluno não encontrado.');

    const processActions = state.absences
        .filter(a => a.processId === action.processId)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    if (processActions.length === 0) return showToast('Nenhuma ação encontrada para este processo.');

    const firstActionWithAbsenceData = processActions.find(a => a.periodoFaltasStart);
    const visitAction = processActions.find(a => a.actionType === 'visita');
    const contactAttempts = processActions.filter(a => a.actionType.startsWith('tentativa'));
    
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');

    let attemptsSummary = contactAttempts.map((attempt, index) => {
        return `
            <p class="ml-4">- <strong>${index + 1}ª Tentativa (${formatDate(attempt.contactDate || attempt.createdAt?.toDate())}):</strong> 
            ${attempt.contactSucceeded === 'yes' 
                ? `Contato realizado com ${formatText(attempt.contactPerson)}. Justificativa: ${formatText(attempt.contactReason)}.` 
                : 'Não foi possível estabelecer contato.'}
            </p>
        `;
    }).join('');
    if (!attemptsSummary) attemptsSummary = "<p class='ml-4'>Nenhuma tentativa de contato registrada.</p>";

    const oficioHTML = `
        <div class="space-y-6 text-sm text-gray-800" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            <div class="text-center">
                <p class="font-bold uppercase">${config.schoolName}</p>
                <p>${config.city}, ${currentDate}.</p>
            </div>

            <div class="mt-8">
                <p class="font-bold text-base">OFÍCIO Nº ${String(finalOficioNumber).padStart(3, '0')}/${finalOficioYear}</p>
            </div>

            <div class="mt-8">
                <p><strong>Ao</strong></p>
                <p><strong>Conselho Tutelar</strong></p>
                <p><strong>Nesta</strong></p>
            </div>

            <div class="mt-8">
                <p><strong>Assunto:</strong> Encaminhamento de aluno infrequente.</p>
            </div>

            <div class="mt-8 text-justify">
                <p class="indent-8">Prezados(as) Conselheiros(as),</p>
                <p class="mt-4 indent-8">
                    Encaminhamos a V. Sa. o caso do(a) aluno(a) <strong>${student.name}</strong>,
                    regularmente matriculado(a) na turma <strong>${student.class}</strong> desta Unidade de Ensino,
                    filho(a) de <strong>${responsaveis}</strong>, residente no endereço: ${formatText(student.endereco)}.
                </p>
                <p class="mt-4 indent-8">
                    O(A) referido(a) aluno(a) apresenta um número de <strong>${firstActionWithAbsenceData?.absenceCount || '(não informado)'} faltas</strong>,
                    apuradas no período de ${formatPeriodo(firstActionWithAbsenceData?.periodoFaltasStart, firstActionWithAbsenceData?.periodoFaltasEnd)}.
                </p>
                <p class="mt-4 indent-8">
                    Informamos que a escola esgotou as tentativas de contato com a família, conforme descrito abaixo:
                </p>
                <div class="mt-2">${attemptsSummary}</div>
                <p class="mt-4 indent-8">
                    Adicionalmente, foi realizada uma visita in loco em <strong>${formatDate(visitAction?.visitDate)}</strong> pelo agente escolar <strong>${formatText(visitAction?.visitAgent)}</strong>.
                    Durante a visita, ${visitAction?.visitSucceeded === 'yes' 
                        ? `foi possível conversar com ${formatText(visitAction?.visitContactPerson)}, que justificou a ausência devido a: ${formatText(visitAction?.visitReason)}.`
                        : 'não foi possível localizar ou contatar os responsáveis.'}
                </p>
                <p class="mt-4 indent-8">
                    Diante do exposto e considerando o que preceitua o Art. 56 do Estatuto da Criança e do Adolescente (ECA), solicitamos as devidas providências deste Conselho para garantir o direito à educação do(a) aluno(a).
                </p>
            </div>

            <div class="mt-12 text-center">
                <p>Atenciosamente,</p>
            </div>
            
            <div class="signature-block pt-16 mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="mt-1">Diretor(a)</p>
                </div>
            </div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = `Ofício Nº ${finalOficioNumber}`;
    document.getElementById('report-view-content').innerHTML = oficioHTML;
    openModal(dom.reportViewModalBackdrop);
};

const generateAndShowReport = (studentId) => {
    const studentOccurrences = state.occurrences.filter(occ => occ.studentId === studentId).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (studentOccurrences.length === 0) return showToast('Nenhuma ocorrência para este aluno.');

    const studentData = state.students.find(s => s.matricula === studentId);
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const reportHTML = `<div class="space-y-6 text-sm"><div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${config.schoolName}</h2><h3 class="text-lg font-semibold mt-2">RELATÓRIO DE OCORRÊNCIAS</h3></div><div class="pt-4 text-left"><p><strong>ALUNO(A):</strong> ${studentData.name}</p><p><strong>TURMA:</strong> ${studentData.class}</p><p><strong>DATA:</strong> ${currentDate}</p></div>${studentOccurrences.map((occ, index) => `<div class="border-t pt-4 mt-4"><h4 class="font-semibold mb-2 text-base">OCORRÊNCIA ${index + 1} - Data: ${formatDate(occ.date)}</h4><div class="pl-4 border-l-2 border-gray-200 space-y-2"><div><p class="font-medium">Tipo:</p><p class="text-gray-700 bg-gray-50 p-2 rounded-md">${formatText(occ.occurrenceType)}</p></div><div><p class="font-medium">Descrição:</p><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(occ.description)}</p></div><div><p class="font-medium">Providências da Escola:</p><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(occ.actionsTakenSchool)}</p></div></div></div>`).join('')}<div class="border-t pt-16 mt-8"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Assinatura da Coordenação</p></div></div></div>`;
    
    document.getElementById('report-view-title').textContent = "Relatório de Ocorrências";
    document.getElementById('report-view-content').innerHTML = reportHTML;
    openModal(dom.reportViewModalBackdrop);
};

const generateAndShowConsolidatedFicha = (studentId, processId = null) => {
    let studentActions = state.absences.filter(action => action.studentId === studentId);
    
    if (processId) {
        studentActions = studentActions.filter(action => action.processId === processId);
    }

    studentActions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));

    if (studentActions.length === 0) return showToast('Nenhuma ação para este aluno neste processo.');
    const studentData = state.students.find(s => s.matricula === studentId);

    const findAction = (type) => studentActions.find(a => a.actionType === type) || {};
    const t1 = findAction('tentativa_1'), t2 = findAction('tentativa_2'), t3 = findAction('tentativa_3'), visita = findAction('visita'), ct = findAction('encaminhamento_ct'), analise = findAction('analise');
    
    const faltasData = t1.periodoFaltasStart ? t1 : (t2.periodoFaltasStart ? t2 : (t3.periodoFaltasStart ? t3 : (visita.periodoFaltasStart ? visita : {})));

    const fichaHTML = `
        <div class="space-y-4 text-sm">
            <div class="text-center border-b pb-4">
                <h2 class="text-lg font-bold uppercase">${config.schoolName}</h2>
                <h3 class="font-semibold mt-1">Ficha de Acompanhamento da Busca Ativa</h3>
            </div>
            
            <div class="border rounded-md p-3">
                <h4 class="font-semibold text-base mb-2">Identificação</h4>
                <p><strong>Nome do aluno:</strong> ${studentData.name}</p>
                <p><strong>Ano/Ciclo:</strong> ${studentData.class || ''}</p>
                <p><strong>Endereço:</strong> ${formatText(studentData.endereco)}</p>
                <p><strong>Contato:</strong> ${formatText(studentData.contato)}</p>
            </div>

            <div class="border rounded-md p-3">
                <h4 class="font-semibold text-base mb-2">Faltas apuradas no período de:</h4>
                <p><strong>Data de início:</strong> ${formatDate(faltasData.periodoFaltasStart)}</p>
                <p><strong>Data de fim:</strong> ${formatDate(faltasData.periodoFaltasEnd)}</p>
                <p><strong>Nº de faltas:</strong> ${formatText(faltasData.absenceCount)}</p>
            </div>

            <div class="border rounded-md p-3 space-y-3">
                <h4 class="font-semibold text-base">Tentativas de contato com o responsável pelo estudante (ligações, whatsApp ou carta ao responsável)</h4>
                <div class="pl-4">
                    <p class="font-medium underline">1ª Tentativa:</p>
                    <p><strong>Conseguiu contato?</strong> ${t1.contactSucceeded === 'yes' ? 'Sim' : t1.contactSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Dia do contato:</strong> ${formatDate(t1.contactDate)}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(t1.contactPerson)}</p>
                    <p><strong>Justificativa:</strong> ${formatText(t1.contactReason)}</p>
                    <p><strong>Aluno retornou?</strong> ${t1.contactReturned === 'yes' ? 'Sim' : t1.contactReturned === 'no' ? 'Não' : ''}</p>
                </div>
                <div class="pl-4 border-t pt-2">
                    <p class="font-medium underline">2ª Tentativa:</p>
                    <p><strong>Conseguiu contato?</strong> ${t2.contactSucceeded === 'yes' ? 'Sim' : t2.contactSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Dia do contato:</strong> ${formatDate(t2.contactDate)}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(t2.contactPerson)}</p>
                    <p><strong>Justificativa:</strong> ${formatText(t2.contactReason)}</p>
                    <p><strong>Aluno retornou?</strong> ${t2.contactReturned === 'yes' ? 'Sim' : t2.contactReturned === 'no' ? 'Não' : ''}</p>
                </div>
                <div class="pl-4 border-t pt-2">
                    <p class="font-medium underline">3ª Tentativa:</p>
                    <p><strong>Conseguiu contato?</strong> ${t3.contactSucceeded === 'yes' ? 'Sim' : t3.contactSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Dia do contato:</strong> ${formatDate(t3.contactDate)}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(t3.contactPerson)}</p>
                    <p><strong>Justificativa:</strong> ${formatText(t3.contactReason)}</p>
                    <p><strong>Aluno retornou?</strong> ${t3.contactReturned === 'yes' ? 'Sim' : t3.contactReturned === 'no' ? 'Não' : ''}</p>
                </div>
            </div>

            <div class="border rounded-md p-3 space-y-2">
                <h4 class="font-semibold text-base">Contato in loco/Conversa com o responsável</h4>
                <p><strong>Nome do agente que realizou a visita:</strong> ${formatText(visita.visitAgent)}</p>
                <p><strong>Dia da visita:</strong> ${formatDate(visita.visitDate)}</p>
                <p><strong>Conseguiu contato?</strong> ${visita.visitSucceeded === 'yes' ? 'Sim' : visita.visitSucceeded === 'no' ? 'Não' : ''}</p>
                <p><strong>Com quem falou?</strong> ${formatText(visita.visitContactPerson)}</p>
                <p><strong>Justificativa:</strong> ${formatText(visita.visitReason)}</p>
                <p><strong>Aluno retornou?</strong> ${visita.visitReturned === 'yes' ? 'Sim' : visita.visitReturned === 'no' ? 'Não' : ''}</p>
                <p><strong>Observação:</strong> ${formatText(visita.visitObs)}</p>
            </div>

            <div class="border rounded-md p-3 space-y-2">
                <h4 class="font-semibold text-base">Encaminhamento ao Conselho Tutelar</h4>
                <p><strong>Data de envio:</strong> ${formatDate(ct.ctSentDate)}</p>
                <p><strong>Devolutiva:</strong> ${formatText(ct.ctFeedback)}</p>
                <p><strong>Aluno retornou?</strong> ${ct.ctReturned === 'yes' ? 'Sim' : ct.ctReturned === 'no' ? 'Não' : ''}</p>
            </div>

            <div class="border rounded-md p-3 space-y-2">
                <h4 class="font-semibold text-base">Análise</h4>
                <p><strong>Parecer da BAE:</strong> ${formatText(analise.ctParecer)}</p>
            </div>
            
            <div class="signature-block pt-16 mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="mt-1">Diretor(a)</p>
                </div>
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="mt-1">Coordenador(a) Pedagógico(a)</p>
                </div>
            </div>
        </div>`;
    document.getElementById('report-view-title').textContent = "Ficha Consolidada de Busca Ativa";
    document.getElementById('report-view-content').innerHTML = fichaHTML;
    openModal(dom.reportViewModalBackdrop);
};

const toggleFamilyContactFields = (enable, fieldsContainer) => {
    const detailFields = fieldsContainer.querySelectorAll('input[type="date"], input[type="text"], textarea');
    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable;
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

const toggleVisitContactFields = (enable, fieldsContainer) => {
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable;
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

const openAbsenceModalForStudent = (student, forceActionType = null, data = null) => {
    dom.absenceForm.reset();

    dom.absenceForm.querySelectorAll('input, textarea').forEach(el => el.required = false);

    const isEditing = !!data;
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Registar Ação de Busca Ativa';
    document.getElementById('absence-id').value = isEditing ? data.id : '';

    document.getElementById('absence-student-name').value = student.name || '';
    document.getElementById('absence-student-class').value = student.class || '';
    document.getElementById('absence-student-endereco').value = student.endereco || '';
    document.getElementById('absence-student-contato').value = student.contato || '';
    
    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
    document.getElementById('absence-process-id').value = data?.processId || processId;

    const finalActionType = forceActionType || (isEditing ? data.actionType : determineNextActionForStudent(student.matricula));
    document.getElementById('action-type').value = finalActionType;
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || '';
    document.getElementById('action-type').dispatchEvent(new Event('change'));

    const absenceFieldsContainer = dom.absenceForm.querySelector('#absence-form > .bg-gray-50');
    const absenceInputs = absenceFieldsContainer.querySelectorAll('input');
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart);

    const readOnlyAbsenceData = (finalActionType !== 'tentativa_1' && !isEditing) || (isEditing && firstAbsenceRecordInCycle && data.id !== firstAbsenceRecordInCycle.id);

    if (!readOnlyAbsenceData) {
        document.getElementById('absence-start-date').required = true;
        document.getElementById('absence-end-date').required = true;
        document.getElementById('absence-count').required = true;
    }

    if (readOnlyAbsenceData) {
        const source = firstAbsenceRecordInCycle || data;
        document.getElementById('absence-start-date').value = source.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = source.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = source.absenceCount || '';
        absenceInputs.forEach(input => input.readOnly = true);
    } else {
        absenceInputs.forEach(input => input.readOnly = false);
    }
    
    switch (finalActionType) {
        case 'tentativa_1':
        case 'tentativa_2':
        case 'tentativa_3':
            document.getElementById('meeting-date').required = true;
            document.getElementById('meeting-time').required = true;
            break;
        case 'visita':
            document.getElementById('visit-agent').required = true;
            document.getElementById('visit-date').required = true;
            break;
        case 'encaminhamento_ct':
            document.getElementById('ct-sent-date').required = true;
            break;
    }
    
    if (isEditing) {
        if (!readOnlyAbsenceData) {
            document.getElementById('absence-start-date').value = data.periodoFaltasStart || '';
            document.getElementById('absence-end-date').value = data.periodoFaltasEnd || '';
            document.getElementById('absence-count').value = data.absenceCount || '';
        }
        
        switch (data.actionType) {
            case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                document.getElementById('meeting-date').value = data.meetingDate || '';
                document.getElementById('meeting-time').value = data.meetingTime || '';
                if(data.contactSucceeded) {
                    document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`).checked = true;
                    document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`).dispatchEvent(new Event('change'));
                }
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                if(data.contactReturned) document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`).checked = true;
                break;
            case 'visita':
                document.getElementById('visit-agent').value = data.visitAgent || '';
                document.getElementById('visit-date').value = data.visitDate || '';
                if(data.visitSucceeded) {
                    document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`).checked = true;
                    document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`).dispatchEvent(new Event('change'));
                }
                document.getElementById('visit-contact-person').value = data.visitContactPerson || '';
                document.getElementById('visit-reason').value = data.visitReason || '';
                document.getElementById('visit-obs').value = data.visitObs || '';
                if (data.visitReturned) document.querySelector(`input[name="visit-returned"][value="${data.visitReturned}"]`).checked = true;
                break;
            case 'encaminhamento_ct':
                document.getElementById('ct-sent-date').value = data.ctSentDate || '';
                document.getElementById('ct-feedback').value = data.ctFeedback || '';
                if (data.ctReturned) document.querySelector(`input[name="ct-returned"][value="${data.ctReturned}"]`).checked = true;
                break;
            case 'analise':
                document.getElementById('ct-parecer').value = data.ctParecer || '';
                break;
        }
    } else {
          toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
          toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
    }
    
    openModal(dom.absenceModal);
};

const setupEventListeners = () => {
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);

    dom.tabOccurrences.addEventListener('click', () => { state.activeTab = 'occurrences'; dom.tabOccurrences.classList.add('tab-active'); dom.tabAbsences.classList.remove('tab-active'); dom.tabContentOccurrences.classList.remove('hidden'); dom.tabContentAbsences.classList.add('hidden'); render(); });
    dom.tabAbsences.addEventListener('click', () => { state.activeTab = 'absences'; dom.tabAbsences.classList.add('tab-active'); dom.tabOccurrences.classList.remove('tab-active'); dom.tabContentAbsences.classList.remove('hidden'); dom.tabContentOccurrences.classList.add('hidden'); render(); });

    document.getElementById('share-btn').addEventListener('click', () => {
        const title = document.getElementById('notification-title').textContent;
        const content = document.getElementById('notification-content').innerText;
        shareContent(title, content);
    });

    document.getElementById('report-share-btn').addEventListener('click', () => {
        const title = document.getElementById('report-view-title').textContent;
        const content = document.getElementById('report-view-content').innerText;
        shareContent(title, content);
    });

    document.getElementById('ficha-share-btn').addEventListener('click', () => {
        const title = document.getElementById('ficha-view-title').textContent;
        const content = document.getElementById('ficha-view-content').innerText;
        shareContent(title, content);
    });


    ['close-modal-btn', 'cancel-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => closeModal(dom.occurrenceModal)));
    ['close-absence-modal-btn', 'cancel-absence-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => closeModal(dom.absenceModal)));
    ['close-report-generator-btn', 'cancel-report-generator-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => closeModal(dom.reportGeneratorModal)));
    document.getElementById('close-notification-btn').addEventListener('click', () => closeModal(dom.notificationModalBackdrop));
    document.getElementById('close-report-view-btn').addEventListener('click', () => closeModal(dom.reportViewModalBackdrop));
    document.getElementById('close-ficha-view-btn').addEventListener('click', () => closeModal(dom.fichaViewModalBackdrop));
    document.getElementById('cancel-delete-btn').addEventListener('click', () => closeModal(dom.deleteConfirmModal));
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());

    dom.occurrenceStartDate.addEventListener('change', (e) => {
        state.filtersOccurrences.startDate = e.target.value;
        render();
    });
    dom.occurrenceEndDate.addEventListener('change', (e) => {
        state.filtersOccurrences.endDate = e.target.value;
        render();
    });

    document.getElementById('filter-process-status').addEventListener('change', (e) => {
        state.filtersAbsences.processStatus = e.target.value;
        render();
    });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => {
        state.filtersAbsences.pendingAction = e.target.value;
        render();
    });
    document.getElementById('filter-return-status').addEventListener('change', (e) => {
        state.filtersAbsences.returnStatus = e.target.value;
        render();
    });

    dom.occurrenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('occurrence-id').value;
        const studentName = document.getElementById('student-name').value.trim();
        const student = state.students.find(s => s.name === studentName);
        if (!student) {
            showToast("Aluno inválido. Por favor, selecione um aluno da lista.");
            return;
        }
        const data = { 
            studentId: student.matricula,
            date: document.getElementById('occurrence-date').value, 
            occurrenceType: document.getElementById('occurrence-type').value,
            description: document.getElementById('description').value.trim(), 
            involved: document.getElementById('involved').value.trim(), 
            actionsTakenSchool: document.getElementById('actions-taken-school').value.trim(), 
            actionsTakenFamily: document.getElementById('actions-taken-family').value.trim(), 
            meetingDate: document.getElementById('meeting-date-occurrence').value, 
            meetingTime: document.getElementById('meeting-time-occurrence').value 
        };
        try { id ? await updateRecord('occurrence', id, data) : await addRecord('occurrence', data); showToast(`Ocorrência ${id ? 'atualizada' : 'registada'} com sucesso!`); closeModal(dom.occurrenceModal); } catch (error) { console.error("Erro:", error); showToast('Erro ao salvar.'); }
    });

    dom.absenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        if (!form.checkValidity()) {
            showToast('Por favor, preencha todos os campos obrigatórios.');
            form.reportValidity();
            return;
        }
        
        const id = document.getElementById('absence-id').value;
        const studentName = document.getElementById('absence-student-name').value.trim();
        const student = state.students.find(s => s.name === studentName);
        if (!student) {
            showToast("Aluno inválido. Por favor, selecione um aluno da lista.");
            return;
        }
        const actionType = document.getElementById('action-type').value;
        const processId = document.getElementById('absence-process-id').value;
        const data = { 
            studentId: student.matricula,
            actionType,
            processId
        };

        try {
            data.periodoFaltasStart = document.getElementById('absence-start-date').value || null;
            data.periodoFaltasEnd = document.getElementById('absence-end-date').value || null;
            data.absenceCount = document.getElementById('absence-count').value || null;

            switch (actionType) {
                case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                    data.meetingDate = document.getElementById('meeting-date').value || null;
                    data.meetingTime = document.getElementById('meeting-time').value || null;
                    const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
                    data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
                    if (data.contactSucceeded === 'yes') {
                        data.contactDate = document.getElementById('contact-date').value || null;
                        data.contactPerson = document.getElementById('contact-person').value || null;
                        data.contactReason = document.getElementById('contact-reason').value || null;
                    }
                    const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
                    data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;
                    break;
                case 'visita':
                    data.visitAgent = document.getElementById('visit-agent').value || null;
                    data.visitDate = document.getElementById('visit-date').value || null;
                    const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
                    data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
                     if (data.visitSucceeded === 'yes') {
                        data.visitContactPerson = document.getElementById('visit-contact-person').value || null;
                        data.visitReason = document.getElementById('visit-reason').value || null;
                        data.visitObs = document.getElementById('visit-obs').value || null;
                    }
                    const visitRadio = document.querySelector('input[name="visit-returned"]:checked');
                    data.visitReturned = visitRadio ? visitRadio.value : null;
                    break;
                case 'encaminhamento_ct':
                    data.ctSentDate = document.getElementById('ct-sent-date').value || null;
                    data.ctFeedback = document.getElementById('ct-feedback').value || null;
                    const ctRadio = document.querySelector('input[name="ct-returned"]:checked');
                    data.ctReturned = ctRadio ? ctRadio.value : null;
                    break;
                case 'analise':
                    data.ctParecer = document.getElementById('ct-parecer').value || null;
                    break;
            }
        } catch (error) {
            console.error("Erro ao recolher dados do formulário:", error);
            showToast("Erro interno ao ler os campos do formulário.");
            return;
        }

        try {
            const isNewRecord = !id;
            if (isNewRecord) {
                const newDocRef = await addRecord('absence', data);
                data.id = newDocRef.id;
                state.absences.push(data);
            } else {
                await updateRecord('absence', id, data);
            }
            
            showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
            
            const studentReturned = (data.actionType.startsWith('tentativa') && data.contactReturned === 'yes') || (data.actionType === 'visita' && data.visitReturned === 'yes');

            closeModal(dom.absenceModal);

            if (studentReturned) {
                setTimeout(() => openAbsenceModalForStudent(student, 'analise'), 350);
            }

        } catch (error) { 
            console.error("Erro ao salvar ação:", error); 
            showToast('Erro ao salvar.'); 
        }
    });

    dom.absencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const header = target.closest('.process-header');
        const button = target.closest('button');
        const studentNameP = target.closest('.new-action-from-history-btn');

        if (studentNameP && !button) {
            e.stopPropagation();
            const studentId = studentNameP.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) {
                handleNewAbsenceAction(student);
            }
            return;
        }

        if (header && !button) { 
            const processId = header.dataset.processId;
            const content = document.getElementById(`content-${processId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                    content.style.maxHeight = null;
                    icon.classList.remove('rotate-180');
                } else {
                    content.style.maxHeight = content.scrollHeight + "px";
                    icon.classList.add('rotate-180');
                }
            }
        }

        if(button) {
            const id = button.dataset.id;
            if (button.classList.contains('generate-ficha-btn-row')) {
                e.stopPropagation();
                const studentId = button.dataset.studentId;
                const processId = button.dataset.processId;
                generateAndShowConsolidatedFicha(studentId, processId);
                return; 
            }

            if (button.classList.contains('edit-absence-btn')) {
                const data = state.absences.find(a => a.id === id);
                const student = state.students.find(s => s.matricula === data.studentId);
                if (data && student) {
                    openAbsenceModalForStudent(student, data.actionType, data);
                }
            }
            else if (button.classList.contains('delete-absence-btn')) { 
                const actionToDelete = state.absences.find(a => a.id === id);
                if (!actionToDelete) return;
                
                const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
                const processActions = state.absences.filter(a => a.processId === actionToDelete.processId);
                const deleteIndex = sequence.indexOf(actionToDelete.actionType);
                const hasLaterAction = processActions.some(a => sequence.indexOf(a.actionType) > deleteIndex);

                if (hasLaterAction) {
                    showToast("Ação não pode ser excluída. Por favor, exclua a etapa mais recente deste processo primeiro.");
                    return;
                }

                if (actionToDelete.actionType === 'encaminhamento_ct') {
                     const analiseAction = processActions.find(a => a.actionType === 'analise');
                     document.getElementById('delete-confirm-message').textContent = 'Tem certeza? A etapa de Análise associada a este processo também será excluída. Esta ação não pode ser desfeita.';
                     state.recordToDelete = { type: 'absence-cascade', ctId: id, analiseId: analiseAction ? analiseAction.id : null };
                } else {
                     document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.';
                     state.recordToDelete = { type: 'absence', id: id };
                }
                openModal(dom.deleteConfirmModal); 
            }
            else if (button.classList.contains('notification-btn')) { 
                openFichaViewModal(id);
            } else if (button.classList.contains('send-ct-btn')) {
                const oficioNumber = prompt("Por favor, insira o número do ofício:");
                if (oficioNumber && oficioNumber.trim() !== '') {
                    const visitAction = state.absences.find(a => a.id === id);
                    if (!visitAction) return;

                    generateAndShowOficio(visitAction, oficioNumber); 

                    const student = state.students.find(s => s.matricula === visitAction.studentId);
                    if (!student) return;

                    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);

                    const alreadyExists = currentCycleActions.some(a => a.actionType === 'encaminhamento_ct');
                    if (alreadyExists) return;

                    const firstActionWithAbsenceData = currentCycleActions.find(a => a.periodoFaltasStart);
                    
                    const dataForCtAction = {
                        studentId: student.matricula,
                        actionType: 'encaminhamento_ct',
                        processId: processId,
                        ctSentDate: new Date().toISOString().split('T')[0],
                        oficioNumber: oficioNumber,
                        oficioYear: new Date().getFullYear(),
                        periodoFaltasStart: firstActionWithAbsenceData?.periodoFaltasStart || null,
                        periodoFaltasEnd: firstActionWithAbsenceData?.periodoFaltasEnd || null,
                        absenceCount: firstActionWithAbsenceData?.absenceCount || null,
                    };
                    
                    addRecord('absence', dataForCtAction).then(() => {
                        showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente.");
                    }).catch(error => {
                        console.error("Erro ao salvar o encaminhamento ao CT:", error);
                        showToast("Erro ao salvar o encaminhamento automático.");
                    });
                }
            } else if (button.classList.contains('view-oficio-btn')) {
                const ctAction = state.absences.find(a => a.id === id);
                if (ctAction) {
                    generateAndShowOficio(ctAction);
                }
            }
        }
    });

    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');
        const header = target.closest('.process-header');
        const studentNameSpan = target.closest('.new-occurrence-from-history-btn');

        if (studentNameSpan && !button) {
            e.stopPropagation();
            const studentId = studentNameSpan.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) {
                openOccurrenceModalForStudent(student);
            }
            return;
        }
        
        if (header && !button && !target.closest('button')) { 
            const studentId = header.dataset.studentIdOcc;
            const content = document.getElementById(`content-occ-${studentId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                    content.style.maxHeight = null;
                    icon.classList.remove('rotate-180');
                } else {
                    content.style.maxHeight = content.scrollHeight + "px";
                    icon.classList.add('rotate-180');
                }
            }
            return;
        }

        if (button) {
            const studentId = button.dataset.studentId;
            if(button.classList.contains('generate-student-report-btn')){
                generateAndShowReport(studentId);
                return;
            }

            const id = button.dataset.id;
            if (button.classList.contains('edit-btn')) {
                const data = state.occurrences.find(o => o.id === id);
                const student = state.students.find(s => s.matricula === data.studentId);
                if (data && student) {
                    dom.occurrenceForm.reset();
                    document.getElementById('modal-title').innerText = 'Editar Registro de Ocorrência';
                    document.getElementById('occurrence-id').value = data.id || '';
                    document.getElementById('student-name').value = student.name || '';
                    document.getElementById('student-class').value = student.class || '';
                    document.getElementById('occurrence-type').value = data.occurrenceType || '';
                    document.getElementById('occurrence-date').value = data.date || '';
                    document.getElementById('description').value = data.description || '';
                    document.getElementById('involved').value = data.involved || '';
                    document.getElementById('actions-taken-school').value = data.actionsTakenSchool || '';
                    document.getElementById('actions-taken-family').value = data.actionsTakenFamily || '';
                    document.getElementById('meeting-date-occurrence').value = data.meetingDate || '';
                    document.getElementById('meeting-time-occurrence').value = data.meetingTime || '';
                    openModal(dom.occurrenceModal);
                }
            }
            else if (button.classList.contains('delete-btn')) { 
                document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.';
                state.recordToDelete = { type: 'occurrence', id: id }; openModal(dom.deleteConfirmModal);
            }
            else if (button.classList.contains('view-btn')) { openNotificationModal(id); }
        }
    });

    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (state.recordToDelete) {
            try {
                if (state.recordToDelete.type === 'absence-cascade') {
                    const batch = writeBatch(state.db);
                    const ctRef = doc(getCollectionRef('absence'), state.recordToDelete.ctId);
                    batch.delete(ctRef);
                    if (state.recordToDelete.analiseId) {
                        const analiseRef = doc(getCollectionRef('absence'), state.recordToDelete.analiseId);
                        batch.delete(analiseRef);
                    }
                    await batch.commit();
                    showToast('Encaminhamento e Análise foram excluídos.');
                } else {
                    await deleteRecord(state.recordToDelete.type, state.recordToDelete.id);
                    showToast('Registro excluído com sucesso.');
                }
            } catch (error) {
                console.error("Erro ao excluir:", error);
                showToast('Erro ao excluir.');
            } finally {
                state.recordToDelete = null;
                closeModal(dom.deleteConfirmModal);
            }
        }
    });
    
    document.getElementById('create-report-btn').addEventListener('click', () => {
        const selectedStudentId = document.getElementById('student-select').value;
        if (!selectedStudentId) return showToast('Por favor, selecione um aluno.');
        const reportType = dom.reportGeneratorModal.dataset.reportType;
        if (reportType === 'occurrences') generateAndShowReport(selectedStudentId);
        else generateAndShowConsolidatedFicha(selectedStudentId);
        closeModal(dom.reportGeneratorModal);
    });
    document.getElementById('action-type').addEventListener('change', (e) => {
        const action = e.target.value;
        document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
        if (action.startsWith('tentativa')) { 
            document.getElementById('group-tentativas').classList.remove('hidden');
            toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
        } else if (action === 'visita') {
            document.getElementById('group-visita').classList.remove('hidden');
            toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
        }
        else if (action) { 
            const group = document.getElementById(`group-${action}`); 
            if (group) group.classList.remove('hidden');
        }
    });
    
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'));
        });
    });
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'));
        });
    });

    document.getElementById('manage-students-btn').addEventListener('click', () => {
        renderStudentsList();
        openModal(dom.studentsModal);
    });
    document.getElementById('close-students-modal-btn').addEventListener('click', () => closeModal(dom.studentsModal));
    document.getElementById('upload-csv-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('csv-file');
        const feedbackDiv = document.getElementById('csv-feedback');
        if (fileInput.files.length === 0) {
            showToast("Por favor, selecione um ficheiro CSV.");
            return;
        }
        
        Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const fileHeaders = results.meta.fields;
                
                const hasAllHeaders = requiredHeaders.every(h => fileHeaders.includes(h));

                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: matricula, nome, turma, endereco, contato, resp1, resp2.</p>`;
                    return;
                }

                const newStudentList = results.data.map(row => ({
                    matricula: row.matricula || '',
                    name: row.nome || '',
                    class: row.turma || '',
                    endereco: row.endereco || '',
                    contato: row.contato || '',
                    resp1: row.resp1 || '',
                    resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                try {
                    await setDoc(getStudentsDocRef(), { list: newStudentList });
                    state.students = newStudentList;
                    renderStudentsList();
                    showToast(`${newStudentList.length} alunos importados com sucesso!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = '';
                } catch(error) {
                    console.error("Erro ao salvar lista de alunos:", error);
                    showToast("Erro ao salvar a nova lista de alunos.");
                }
            }
        });
    });

    document.getElementById('student-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('student-id-input').value; // Usando matricula como ID
        const matricula = document.getElementById('student-matricula-input').value.trim();
        const name = document.getElementById('student-name-input').value.trim();
        const studentClass = document.getElementById('student-class-input').value.trim();
        const endereco = document.getElementById('student-endereco-input').value.trim();
        const contato = document.getElementById('student-contato-input').value.trim();
        const resp1 = document.getElementById('student-resp1-input').value.trim();
        const resp2 = document.getElementById('student-resp2-input').value.trim();

        if (!matricula || !name || !studentClass || !resp1) {
            showToast("Matrícula, Nome, Turma e Responsável 1 são obrigatórios.");
            return;
        }
        
        const studentData = { matricula, name, class: studentClass, endereco, contato, resp1, resp2 };
        
        let updatedList = [...state.students];

        if (id) { // Editando
            const index = updatedList.findIndex(s => s.matricula === id);
            if (index > -1) {
                updatedList[index] = studentData;
            }
        } else { // Adicionando
            if (updatedList.some(s => s.matricula === matricula)) {
                showToast("Erro: Matrícula já existe.");
                return;
            }
            updatedList.push(studentData);
        }

        try {
            await setDoc(getStudentsDocRef(), { list: updatedList });
            state.students = updatedList;
            renderStudentsList();
            resetStudentForm();
            showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
        } catch(error) {
            console.error("Erro ao salvar aluno:", error);
            showToast("Erro ao salvar dados do aluno.");
        }
    });

    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);
};

const openOccurrenceModalForStudent = (student) => {
    dom.occurrenceForm.reset();
    document.getElementById('occurrence-id').value = '';
    document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência';
    document.getElementById('student-name').value = student.name;
    document.getElementById('student-class').value = student.class;
    document.getElementById('occurrence-date').valueAsDate = new Date();
    openModal(dom.occurrenceModal);
};

const handleNewAbsenceAction = (student) => {
    const { currentCycleActions } = getStudentProcessInfo(student.matricula);

    if (currentCycleActions.length > 0) {
        const lastAction = currentCycleActions[currentCycleActions.length - 1];
        let isPending = false;
        let pendingActionMessage = "Complete a etapa anterior para poder prosseguir.";

        if (lastAction.actionType.startsWith('tentativa')) {
            if (lastAction.contactSucceeded == null || lastAction.contactReturned == null) {
                isPending = true;
            }
        } 
        else if (lastAction.actionType === 'visita') {
            if (lastAction.visitSucceeded == null || lastAction.visitReturned == null) {
                isPending = true;
            }
        }
        else if (lastAction.actionType === 'encaminhamento_ct') {
            if (lastAction.ctFeedback == null || lastAction.ctReturned == null) {
                isPending = true;
                pendingActionMessage = "Preencha a devolutiva e o status de retorno do CT para poder analisar o processo.";
            }
        }

        if (isPending) {
            showToast(pendingActionMessage);
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction);
            return; 
        }
    }

    openAbsenceModalForStudent(student);
};

const setupAutocomplete = (inputId, suggestionsId, onSelectCallback) => {
    const input = document.getElementById(inputId);
    const suggestionsContainer = document.getElementById(suggestionsId);
    
    input.addEventListener('input', () => {
        const value = input.value.toLowerCase();
        if (inputId === 'search-occurrences') state.filterOccurrences = value;
        if (inputId === 'search-absences') state.filterAbsences = value;
        render();
        suggestionsContainer.innerHTML = '';
        if (!value) {
            suggestionsContainer.classList.add('hidden');
            return;
        }
        
        const filteredStudents = state.students.filter(s => s.name.toLowerCase().startsWith(value)).slice(0, 5);
        
        if (filteredStudents.length > 0) {
            suggestionsContainer.classList.remove('hidden');
            filteredStudents.forEach(student => {
                const item = document.createElement('div');
                item.classList.add('suggestion-item');
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    if (onSelectCallback) {
                        onSelectCallback(student);
                    } 
                    input.value = '';
                    if (inputId === 'search-occurrences') state.filterOccurrences = '';
                    if (inputId === 'search-absences') state.filterAbsences = '';
                    render();
                    suggestionsContainer.classList.add('hidden');
                });
                suggestionsContainer.appendChild(item);
            });
        } else {
            suggestionsContainer.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!suggestionsContainer.contains(e.target) && e.target !== input) {
            suggestionsContainer.classList.add('hidden');
        }
    });
};

const renderStudentsList = () => {
    const tableBody = document.getElementById('students-list-table');
    tableBody.innerHTML = '';
    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-2">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}"><i class="fas fa-pencil-alt"></i></button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    document.querySelectorAll('.edit-student-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const student = state.students.find(s => s.matricula === id);
            if (student) {
                document.getElementById('student-form-title').textContent = 'Editar Aluno';
                document.getElementById('student-id-input').value = student.matricula;
                document.getElementById('student-matricula-input').value = student.matricula;
                document.getElementById('student-matricula-input').readOnly = true;
                document.getElementById('student-matricula-input').classList.add('bg-gray-100');
                document.getElementById('student-name-input').value = student.name;
                document.getElementById('student-class-input').value = student.class;
                document.getElementById('student-endereco-input').value = student.endereco || '';
                document.getElementById('student-contato-input').value = student.contato || '';
                document.getElementById('student-resp1-input').value = student.resp1;
                document.getElementById('student-resp2-input').value = student.resp2;
                document.getElementById('cancel-edit-student-btn').classList.remove('hidden');
            }
        });
    });

    document.querySelectorAll('.delete-student-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            const student = state.students.find(s => s.matricula === id);
            if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"?`)) {
                const updatedList = state.students.filter(s => s.matricula !== id);
                try {
                    await setDoc(getStudentsDocRef(), { list: updatedList });
                    state.students = updatedList;
                    renderStudentsList();
                    showToast("Aluno removido com sucesso.");
                } catch(error) {
                    console.error("Erro ao remover aluno:", error);
                    showToast("Erro ao remover aluno.");
                }
            }
        });
    });
};

const resetStudentForm = () => {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    document.getElementById('student-form').reset();
    document.getElementById('student-id-input').value = '';
    document.getElementById('student-matricula-input').readOnly = false;
    document.getElementById('student-matricula-input').classList.remove('bg-gray-100');
    document.getElementById('cancel-edit-student-btn').classList.add('hidden');
};

const showLoginView = () => {
    dom.registerView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
};

const showRegisterView = () => {
    dom.loginView.classList.add('hidden');
    dom.registerView.classList.remove('hidden');
};

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    const finalConfig = (typeof __firebase_config !== 'undefined' && __firebase_config !== '{}') 
        ? JSON.parse(__firebase_config) 
        : firebaseConfig;

    if (Object.keys(finalConfig).length < 2) {
        document.body.innerHTML = `<div class="p-8 text-center text-red-700 bg-red-100"><h1>Configuração Incompleta do Firebase</h1><p class="mt-2">A aplicação não pode ser iniciada.</p></div>`;
        return;
    }

    const app = initializeApp(finalConfig);
    const auth = getAuth(app);
    state.db = getFirestore(app);

    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            await setupFirestoreListeners();
        } else {
            state.userId = null;
            state.students = [];
            state.occurrences = [];
            state.absences = [];
            render();
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
        }
    });

    dom.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Erro ao entrar:", error.code);
            showToast("Email ou senha inválidos.");
        }
    });

    dom.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        try {
            await createUserWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Erro ao registar:", error.code);
            if (error.code === 'auth/email-already-in-use') {
                showToast("Este email já está a ser utilizado.");
            } else if (error.code === 'auth/weak-password') {
                showToast("A sua senha é muito fraca.");
            } else {
                showToast("Erro ao criar a conta.");
            }
        }
    });

    dom.logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Erro ao sair:", error);
        }
    });

    setupEventListeners();
    
    setupAutocomplete('search-occurrences', 'occurrence-student-suggestions', (student) => {
        openOccurrenceModalForStudent(student);
    }); 

    setupAutocomplete('search-absences', 'absence-student-suggestions', (student) => {
        handleNewAbsenceAction(student);
    });
});
