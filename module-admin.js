// =================================================================================
// ARQUIVO: module-admin.js
// RESPONSABILIDADE: Orquestrar a funcionalidade de gerenciamento de alunos
// (lista, formulário, upload CSV) e configurações da escola.
// ATUALIZAÇÃO: Listeners internos são adicionados na primeira abertura do modal.
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal } from './utils.js';
import { saveSchoolConfig } from './firestore.js'; // Para salvar config
import { getStudentsDocRef } from './firestore.js'; // Para salvar/excluir alunos
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; // Para salvar/excluir alunos

// Flags para garantir que os listeners sejam adicionados apenas uma vez
let settingsListenersAttached = false;
let studentsListenersAttached = false;

// --- INICIALIZAÇÃO DO MÓDULO ---

/**
 * Função de inicialização agora é mínima. A lógica principal foi movida
 * para as funções de abertura de modal.
 */
export const initAdmin = () => {
    console.log("Módulo de Admin (module-admin.js) PRONTO (listeners serão adicionados sob demanda).");
    // Não adicionamos listeners aqui para evitar problemas de timing.
};

// --- HANDLERS DE EVENTOS (sem alteração na lógica interna) ---

/**
 * Lida com a submissão do formulário de configurações.
 */
async function handleSettingsSubmit(e) {
    e.preventDefault();
    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim() || null
    };

    if (!data.schoolName) return showToast("O nome da escola é obrigatório.");

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...';

    try {
        await saveSchoolConfig(data);
        state.config = data;
        if (dom.headerSchoolName) dom.headerSchoolName.textContent = data.schoolName;
        showToast('Configurações salvas com sucesso!');
        // Idealmente, o closeModal seria chamado pelo listener do botão Cancelar/Fechar
        // import { closeModal } from './utils.js';
        // closeModal(dom.settingsModal);
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

/**
 * Lida com a submissão do formulário de adição/edição de aluno.
 */
async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value;
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();

    if (!matricula || !name) return showToast("Matrícula e Nome Completo são obrigatórios.");
    if (!document.getElementById('student-class-input').value.trim()) return showToast("A Turma é obrigatória.");
    if (!document.getElementById('student-resp1-input').value.trim()) return showToast("O Responsável 1 é obrigatório.");

    let updatedList = [...state.students];
    const studentData = {
        matricula, name,
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim() || '',
        contato: document.getElementById('student-contato-input').value.trim() || '',
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim() || ''
    };

    if (id) {
        const index = updatedList.findIndex(s => s.matricula === id);
        if (index > -1) {
            if (id !== matricula && updatedList.some((s, i) => i !== index && s.matricula === matricula)) {
                 return showToast("Erro: A nova matrícula já existe para outro aluno.");
            }
            updatedList[index] = { ...studentData, matricula: matricula };
        } else {
            return showToast("Erro: Aluno não encontrado para edição.");
        }
    } else {
        if (updatedList.some(s => s.matricula === matricula)) {
             return showToast("Erro: Matrícula já existe.");
        }
        updatedList.push(studentData);
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...';

    try {
        await setDoc(getStudentsDocRef(), { list: updatedList });
        state.students = updatedList;
        renderStudentsList();
        resetStudentForm();
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
    } catch(error) {
        console.error("Erro ao salvar dados do aluno:", error);
        showToast("Erro ao salvar dados do aluno.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

/**
 * Lida com as ações na tabela de alunos (Editar, Excluir).
 */
async function handleStudentTableActions(e) {
    const editBtn = e.target.closest('.edit-student-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        if (student) {
            document.getElementById('student-form-title').textContent = 'Editar Aluno';
            document.getElementById('student-id-input').value = student.matricula;
            document.getElementById('student-matricula-input').value = student.matricula;
            document.getElementById('student-name-input').value = student.name;
            document.getElementById('student-class-input').value = student.class;
            document.getElementById('student-endereco-input').value = student.endereco || '';
            document.getElementById('student-contato-input').value = student.contato || '';
            document.getElementById('student-resp1-input').value = student.resp1;
            document.getElementById('student-resp2-input').value = student.resp2 || '';
            document.getElementById('cancel-edit-student-btn').classList.remove('hidden');
            document.getElementById('student-name-input').focus();
        }
        return;
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"? Esta ação não pode ser desfeita.`)) {

             deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
             deleteBtn.disabled = true;

            const updatedList = state.students.filter(s => s.matricula !== id);
            try {
                await setDoc(getStudentsDocRef(), { list: updatedList });
                state.students = updatedList;
                renderStudentsList();
                 resetStudentForm();
                showToast("Aluno removido com sucesso.");
            } catch(error) {
                console.error("Erro ao remover aluno:", error);
                showToast("Erro ao remover aluno.");
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.disabled = false;
            }
        }
    }
}


// --- FUNÇÕES DE UPLOAD CSV ---

let papaLoadingPromise = null;

function loadPapaParser() {
    // ... (código loadPapaParser inalterado) ...
     if (typeof window.Papa !== 'undefined' && window.Papa.parse) {
        return Promise.resolve(true);
    }
    if (papaLoadingPromise) {
        return papaLoadingPromise;
    }

    console.log("PapaParse não encontrado ou incompleto, a iniciar carregamento dinâmico...");
    const feedbackDiv = document.getElementById('csv-feedback');
    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-blue-500">A carregar biblioteca de CSV...</p>`;

    papaLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/paparse.min.js';
        script.async = true;
        script.onload = () => {
             if (typeof window.Papa !== 'undefined' && window.Papa.parse) {
                console.log("PapaParse carregado com sucesso.");
                if(feedbackDiv) feedbackDiv.innerHTML = '';
                resolve(true);
             } else {
                 console.error("PapaParse carregado, mas objeto Papa ou função parse não encontrados.");
                 if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro interno ao carregar biblioteca CSV.</p>`;
                 papaLoadingPromise = null;
                 reject(new Error("Falha ao inicializar PapaParse após carregamento."));
             }
        };
        script.onerror = (error) => {
            console.error("Erro de rede ao carregar PapaParse:", error);
            if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro de rede ao carregar a biblioteca CSV. Verifique a conexão.</p>`;
            papaLoadingPromise = null;
            reject(new Error("Falha de rede ao carregar PapaParse."));
        };
        document.body.appendChild(script);
    });
    return papaLoadingPromise;
}

async function handleCsvUpload() {
    // ... (código handleCsvUpload inalterado) ...
     const fileInput = document.getElementById('csv-file');
    const feedbackDiv = document.getElementById('csv-feedback');
    const uploadBtn = document.getElementById('upload-csv-btn');

    if (fileInput.files.length === 0) {
         return showToast("Por favor, selecione um ficheiro CSV.");
    }
    const file = fileInput.files[0];

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Carregar...';
    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-gray-500">A processar o ficheiro...</p>`;

    try {
        await loadPapaParser();

        window.Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim()
                                           .replace(/\s+/g, '')
                                           .normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
            complete: async (results) => {
                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const fileHeaders = (results.meta.fields || []).map(h => h.toLowerCase().trim()
                                                                  .replace(/\s+/g, '')
                                                                  .normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

                const missingHeaders = requiredHeaders.filter(h => !fileHeaders.includes(h));
                if (missingHeaders.length > 0) {
                    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas no CSV. Necessário: ${missingHeaders.join(', ')}.</p>`;
                    resetUploadButton();
                    return;
                }

                const newStudentList = results.data.map(row => {
                     const normalizedRow = {};
                     for (const key in row) {
                         const normalizedKey = key.toLowerCase().trim()
                                                  .replace(/\s+/g, '')
                                                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                         normalizedRow[normalizedKey] = row[key];
                     }

                     return {
                        matricula: normalizedRow.matricula || '',
                        name: normalizedRow.nome || '',
                        class: normalizedRow.turma || '',
                        endereco: normalizedRow.endereco || '',
                        contato: normalizedRow.contato || '',
                        resp1: normalizedRow.resp1 || '',
                        resp2: normalizedRow.resp2 || ''
                     };
                }).filter(s => s.matricula && s.name && s.class && s.resp1);

                if (newStudentList.length === 0) {
                     if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-yellow-500">Nenhum aluno válido encontrado no ficheiro. Verifique os dados (matrícula, nome, turma, resp1 são obrigatórios) e os cabeçalhos.</p>`;
                     resetUploadButton();
                     return;
                }

                try {
                    await setDoc(getStudentsDocRef(), { list: newStudentList });
                    state.students = newStudentList;
                    renderStudentsList();
                    showToast(`${newStudentList.length} alunos importados com sucesso! A lista anterior foi substituída.`);
                    fileInput.value = '';
                    if(feedbackDiv) feedbackDiv.innerHTML = '';
                } catch(dbError) {
                    console.error("Erro ao salvar alunos no Firestore:", dbError);
                    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao salvar a nova lista de alunos no banco de dados.</p>`;
                    showToast("Erro ao salvar a nova lista de alunos.");
                } finally {
                    resetUploadButton();
                }
            },
            error: (err, file) => {
                 console.error("Erro ao parsear CSV:", err, file);
                 if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao ler o ficheiro CSV: ${err.message || 'Verifique o formato do ficheiro.'}</p>`;
                 showToast("Erro ao processar o ficheiro CSV.");
                 resetUploadButton();
            }
        });
    } catch (loadError) {
        showToast(loadError.message);
        if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">${loadError.message}</p>`;
        resetUploadButton();
    }
}

function resetUploadButton() {
     const uploadBtn = document.getElementById('upload-csv-btn');
     if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = 'Carregar CSV';
     }
}


// --- FUNÇÕES DE UI E ABERTURA DE MODAL ---

/**
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * (Função interna, não exportada diretamente antes)
 */
function renderStudentsList() {
    // ... (código renderStudentsList inalterado) ...
     const tableBody = dom.studentsListTable;
    if (!tableBody) {
        console.error("Elemento #students-list-table não encontrado para renderizar.");
        return;
    }

    tableBody.innerHTML = '';

    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900 whitespace-nowrap">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500 whitespace-nowrap">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-3 whitespace-nowrap">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}" title="Editar ${student.name}">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}" title="Excluir ${student.name}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);
    });

     if (state.students.length === 0) {
         tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4">Nenhum aluno registado. Adicione um aluno ou importe via CSV.</td></tr>`;
     }
}

/**
 * Reseta o formulário de adição/edição de aluno.
 * (Função interna)
 */
function resetStudentForm() {
    // ... (código resetStudentForm inalterado) ...
     document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    const form = document.getElementById('student-form');
    if(form) form.reset();
    document.getElementById('student-id-input').value = '';

    document.getElementById('cancel-edit-student-btn').classList.add('hidden');
    document.getElementById('student-matricula-input').focus();
}

/**
 * Abre o modal de configurações, preenche e adiciona listeners se necessário.
 */
export function openSettingsModal() {
    const settingsForm = document.getElementById('settings-form');
    if (!settingsForm) {
        console.error("Formulário #settings-form não encontrado para abrir modal.");
        return showToast("Erro ao abrir configurações.");
    }
    // Preenche o formulário
    settingsForm.reset();
    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';

    // Adiciona listener de submit APENAS SE AINDA NÃO FOI ADICIONADO
    if (!settingsListenersAttached) {
        console.log("A adicionar listener ao #settings-form pela primeira vez.");
        settingsForm.addEventListener('submit', handleSettingsSubmit);
        settingsListenersAttached = true; // Marca como adicionado
    }

    openModal(dom.settingsModal); // Abre o modal
}

/**
 * Abre o modal de alunos, renderiza a lista e adiciona listeners se necessário.
 */
export function openStudentsModalAdmin() {
    if (!dom.studentsModal) {
        console.error("Modal #students-modal não encontrado ao tentar abrir.");
        return showToast("Erro ao tentar abrir o gerenciador de alunos.");
    }

    // Renderiza a lista de alunos atualizada SEMPRE que abrir
    renderStudentsList();

    // Adiciona listeners internos do modal APENAS SE AINDA NÃO FORAM ADICIONADOS
    if (!studentsListenersAttached) {
        console.log("A adicionar listeners ao #students-modal pela primeira vez.");
        const uploadBtn = dom.studentsModal.querySelector('#upload-csv-btn');
        const studentForm = dom.studentsModal.querySelector('#student-form');
        const cancelEditBtn = dom.studentsModal.querySelector('#cancel-edit-student-btn');
        const studentsTable = dom.studentsListTable; // Usar a referência direta

        if (uploadBtn) uploadBtn.addEventListener('click', handleCsvUpload);
        else console.error("Botão #upload-csv-btn não encontrado dentro do modal.");

        if (studentForm) studentForm.addEventListener('submit', handleStudentFormSubmit);
        else console.error("Formulário #student-form não encontrado dentro do modal.");

        if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetStudentForm);
        else console.error("Botão #cancel-edit-student-btn não encontrado dentro do modal.");

        if (studentsTable) studentsTable.addEventListener('click', handleStudentTableActions);
        else console.error("Tabela #students-list-table não encontrada dentro do modal.");

        studentsListenersAttached = true; // Marca como adicionados
    }

    openModal(dom.studentsModal); // Abre o modal
}

