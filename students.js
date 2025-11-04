// =================================================================================
// ARQUIVO: students.js
// RESPONSABILIDADE: Gerenciar a lógica e a UI do modal "Gerir Alunos",
// incluindo adição, edição, exclusão e importação via CSV.
//
// ATUALIZAÇÃO (Sug. 5 - Cores):
// 1. Atualizada a cor do feedback de carregamento (text-blue-500 -> text-sky-500).
// 2. As cores dos botões (Salvar, Editar, Excluir) são controladas
//    no index.html (semanticamente) ou já foram atualizadas lá.
// =================================================================================

import { state, dom } from './state.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStudentsDocRef } from './firestore.js';
import { showToast, openModal, loadScript } from './utils.js'; // Importa loadScript

/**
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * A lógica de clique será gerenciada por delegação de eventos
 * em `handleStudentTableActions` dentro deste módulo.
 * (Movido de ui.js)
 */
const renderStudentsList = () => {
    // Usa a referência do DOM já inicializada
    const tableBody = dom.studentsListTable;
    if (!tableBody) return; // Guarda de segurança

    tableBody.innerHTML = ''; // Limpa a tabela antes de redesenhar.

    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-2">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}" title="Editar">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);
    });
};

/**
 * Reseta o formulário de adição/edição de aluno.
 * (Movido de ui.js)
 */
const resetStudentForm = () => {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    dom.studentForm.reset(); // Usa a referência do DOM
    document.getElementById('student-id-input').value = '';
    document.getElementById('student-matricula-input').readOnly = false;
    document.getElementById('student-matricula-input').classList.remove('bg-gray-100');
    dom.cancelEditStudentBtn.classList.add('hidden'); // Usa a referência do DOM
};

/**
 * Lida com o upload do ficheiro CSV de alunos.
 * (Movido de main.js)
 * (MODIFICADO - Cores)
 */
async function handleCsvUpload() {
    const fileInput = dom.csvFile; // Usa a referência do DOM
    const feedbackDiv = dom.csvFeedback; // Usa a referência do DOM

    if (fileInput.files.length === 0) return showToast("Por favor, selecione um ficheiro CSV.");

    try {
        // Verifica se Papa já está carregado
        if (typeof window.Papa === 'undefined') {
            feedbackDiv.innerHTML = `<p class="text-sky-500">A carregar biblioteca de CSV...</p>`; // Cor atualizada
            const papaScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
            await loadScript(papaScriptUrl);
            if (typeof window.Papa === 'undefined') {
                 throw new Error("Falha ao carregar PapaParse dinamicamente.");
            }
            feedbackDiv.innerHTML = '';
        }

        window.Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                if (!results.meta || !results.meta.fields) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Não foi possível ler os cabeçalhos do ficheiro CSV.</p>`;
                    console.error("Erro ao processar CSV: Metadados inválidos", results);
                    return;
                }

                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const hasAllHeaders = requiredHeaders.every(h => results.meta.fields.includes(h));
                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: ${requiredHeaders.join(', ')}.</p>`;
                    return;
                }

                if (!Array.isArray(results.data)) {
                     feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Não foi possível ler os dados do ficheiro CSV.</p>`;
                     console.error("Erro ao processar CSV: Dados inválidos", results);
                     return;
                }

                const newStudentList = results.data.map(row => ({
                    matricula: row.matricula || '', name: row.nome || '', class: row.turma || '',
                    endereco: row.endereco || '', contato: row.contato || '',
                    resp1: row.resp1 || '', resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                try {
                    await setDoc(getStudentsDocRef(), { list: newStudentList });
                    state.students = newStudentList;
                    renderStudentsList();
                    showToast(`${newStudentList.length} alunos importados com sucesso!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = '';
                } catch(error) {
                    console.error("Erro ao salvar alunos no Firestore:", error);
                    showToast("Erro ao salvar a nova lista de alunos no banco de dados.");
                }
            },
            error: (error, file) => {
                console.error("Erro do PapaParse:", error, file);
                feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao processar o ficheiro CSV: ${error.message}</p>`;
            }
        });

    } catch (error) {
        console.error("Erro ao carregar ou usar PapaParse:", error);
        feedbackDiv.innerHTML = `<p class="text-red-500">Erro crítico ao carregar a biblioteca de CSV. Tente novamente.</p>`;
        showToast("Erro ao carregar a biblioteca de leitura de CSV.");
    }
}

/**
 * Lida com a submissão do formulário de adição/edição de aluno.
 * (Movido de main.js)
 */
async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value; // Usado para saber se é edição
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();
    if (!matricula || !name) return showToast("Matrícula e Nome são obrigatórios.");

    let updatedList = [...state.students];
    const studentData = {
        matricula, name,
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim(),
        contato: document.getElementById('student-contato-input').value.trim(),
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim()
    };

    if (id) { // Se tem id, está editando
        const index = updatedList.findIndex(s => s.matricula === id); // Procura pelo ID original
        if (index > -1) {
            // Verifica se a matrícula foi alterada e se a nova já existe
            if (id !== matricula && updatedList.some((s, i) => s.matricula === matricula && i !== index)) {
                return showToast("Erro: A nova matrícula já pertence a outro aluno.");
            }
            updatedList[index] = studentData; // Atualiza o aluno na lista
        } else {
             return showToast("Erro: Aluno não encontrado para edição."); // Segurança
        }
    } else { // Se não tem id, está adicionando
        if (updatedList.some(s => s.matricula === matricula)) return showToast("Erro: Matrícula já existe.");
        updatedList.push(studentData);
    }

    try {
        await setDoc(getStudentsDocRef(), { list: updatedList });
        state.students = updatedList; // Atualiza o estado global
        renderStudentsList(); // Re-renderiza a tabela no modal
        resetStudentForm(); // Limpa o formulário
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
    } catch(error) {
        console.error("Erro ao salvar aluno:", error);
        showToast("Erro ao salvar dados do aluno.");
    }
}

/**
 * Lida com cliques nos botões de editar e excluir na tabela de alunos.
 * (Movido de main.js)
 */
async function handleStudentTableActions(e) {
    const editBtn = e.target.closest('.edit-student-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        if (student) {
            // Preenche o formulário para edição
            document.getElementById('student-form-title').textContent = 'Editar Aluno';
            document.getElementById('student-id-input').value = student.matricula; // Guarda o ID original
            document.getElementById('student-matricula-input').value = student.matricula;
            // document.getElementById('student-matricula-input').readOnly = true; // Permite editar matrícula agora
            // document.getElementById('student-matricula-input').classList.add('bg-gray-100');
            document.getElementById('student-name-input').value = student.name;
            document.getElementById('student-class-input').value = student.class || '';
            document.getElementById('student-endereco-input').value = student.endereco || '';
            document.getElementById('student-contato-input').value = student.contato || '';
            document.getElementById('student-resp1-input').value = student.resp1 || '';
            document.getElementById('student-resp2-input').value = student.resp2 || '';
            dom.cancelEditStudentBtn.classList.remove('hidden'); // Mostra o botão Cancelar Edição
        }
        return;
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        // Pede confirmação antes de excluir
        if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"? Esta ação não pode ser desfeita.`)) {
            const updatedList = state.students.filter(s => s.matricula !== id);
            try {
                await setDoc(getStudentsDocRef(), { list: updatedList }); // Salva a lista sem o aluno
                state.students = updatedList; // Atualiza o estado
                renderStudentsList(); // Re-renderiza a tabela
                showToast("Aluno removido com sucesso.");
            } catch(error) {
                console.error("Erro ao remover aluno:", error);
                showToast("Erro ao remover aluno.");
            }
        }
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos
 * aos elementos do modal "Gerir Alunos".
 */
export const initStudentListeners = () => {
    // Referências do DOM
    const manageStudentsBtn = document.getElementById('manage-students-btn');
    const { studentsModal, uploadCsvBtn, studentForm, cancelEditStudentBtn, studentsListTable } = dom;

    if (manageStudentsBtn && studentsModal) {
        manageStudentsBtn.addEventListener('click', () => {
            renderStudentsList(); // Garante que a lista está atualizada ao abrir
            openModal(studentsModal);
        });
    }

    if (uploadCsvBtn) {
        uploadCsvBtn.addEventListener('click', handleCsvUpload);
    }

    if (studentForm) {
        studentForm.addEventListener('submit', handleStudentFormSubmit);
    }

    if (cancelEditStudentBtn) {
        cancelEditStudentBtn.addEventListener('click', resetStudentForm);
    }

    // Listener centralizado para a tabela (delegação de eventos)
    if (studentsListTable) {
        studentsListTable.addEventListener('click', handleStudentTableActions);
    }
    
    // Os botões de fechar/cancelar do modal já são tratados pelo `setupModalCloseButtons` no main.js
};
