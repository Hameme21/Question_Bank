import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
    addDoc,
    collection,
    getFirestore,
    onSnapshot,
    query,
    serverTimestamp,
    where
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyA028mrZX2RcDewoBTy0vLHOXWAGR61mOk',
    authDomain: 'uiu-toolkits-admin.firebaseapp.com',
    databaseURL: 'https://uiu-toolkits-admin-default-rtdb.firebaseio.com',
    projectId: 'uiu-toolkits-admin',
    storageBucket: 'uiu-toolkits-admin.firebasestorage.app',
    messagingSenderId: '643628466748',
    appId: '1:643628466748:web:84d4392faf2466654db939',
    measurementId: 'G-3BW6M1SXLP'
};

const QUESTION_COLLECTION = 'questionPapers';
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const page = document.body.dataset.page || 'dashboard';

let approvedPapers = [];
let selectedCourseKey = '';

function $(id) {
    return document.getElementById(id);
}

function normalizeText(value) {
    return String(value || '').trim();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isUniversityEmail(value) {
    return /^[a-z0-9._%+-]+@[a-z0-9-]+\.uiu\.ac\.bd$/i.test(normalizeText(value));
}

function getEmailHandle(email) {
    return normalizeText(email).split('@')[0] || 'Contributor';
}

function setStatus(node, message, type = 'info') {
    if (!node) return;
    node.textContent = message;
    node.className = `status ${type}`;
}

function formatDate(value) {
    if (!value) return 'Recently';
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function paperFromDoc(snapshot) {
    return { id: snapshot.id, ...snapshot.data() };
}

function sortNewestFirst(a, b) {
    const aMs = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
    const bMs = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
    return bMs - aMs;
}

function getSubmitterEmail(paper) {
    return normalizeText(paper.submitterEmail || paper.contactEmail || paper.providedEmail || paper.userEmail || paper.email);
}

function getAssets(paper) {
    const modernAssets = Array.isArray(paper.materialAssets)
        ? paper.materialAssets.map(asset => ({
            assetType: normalizeText(asset.assetType || asset.type).toLowerCase() || 'question',
            topic: normalizeText(asset.topic || paper.topic),
            pdfUrl: normalizeText(asset.pdfUrl || asset.secure_url || asset.secureUrl),
            cloudinaryPublicId: normalizeText(asset.cloudinaryPublicId || asset.public_id || asset.publicId),
            cloudinaryResourceType: normalizeText(asset.cloudinaryResourceType || asset.resource_type || asset.resourceType || 'raw'),
            originalFilename: normalizeText(asset.originalFilename || asset.original_filename)
        }))
        : [];

    const legacyAssets = [
        paper.cloudinaryPublicId ? {
            assetType: 'question',
            topic: normalizeText(paper.topic),
            pdfUrl: normalizeText(paper.pdfUrl),
            cloudinaryPublicId: normalizeText(paper.cloudinaryPublicId),
            cloudinaryResourceType: normalizeText(paper.cloudinaryResourceType || 'raw'),
            originalFilename: normalizeText(paper.originalFilename)
        } : null,
        paper.solutionCloudinaryPublicId ? {
            assetType: 'solution',
            topic: normalizeText(paper.topic),
            pdfUrl: normalizeText(paper.solutionPdfUrl),
            cloudinaryPublicId: normalizeText(paper.solutionCloudinaryPublicId),
            cloudinaryResourceType: normalizeText(paper.solutionCloudinaryResourceType || 'raw'),
            originalFilename: normalizeText(paper.solutionOriginalFilename)
        } : null,
        paper.noteCloudinaryPublicId ? {
            assetType: 'note',
            topic: normalizeText(paper.topic),
            pdfUrl: normalizeText(paper.notePdfUrl),
            cloudinaryPublicId: normalizeText(paper.noteCloudinaryPublicId),
            cloudinaryResourceType: normalizeText(paper.noteCloudinaryResourceType || 'raw'),
            originalFilename: normalizeText(paper.noteOriginalFilename)
        } : null
    ].filter(Boolean);

    const seen = new Set();
    return [...modernAssets, ...legacyAssets].filter(asset => {
        const key = asset.cloudinaryPublicId || `${asset.assetType}:${asset.pdfUrl}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getQuestionAssets(paper) {
    return getAssets(paper).filter(asset => asset.assetType === 'question' || asset.assetType === 'solution');
}

function getNoteAssets(paper) {
    return getAssets(paper).filter(asset => asset.assetType === 'note');
}

function courseKeyFor(paper) {
    return normalizeText(paper.courseCode).toUpperCase() || paper.id;
}

function getCourseGroups(papers = approvedPapers) {
    const groups = new Map();
    papers.forEach(paper => {
        const key = courseKeyFor(paper);
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                code: normalizeText(paper.courseCode).toUpperCase(),
                name: normalizeText(paper.courseName) || 'Untitled Course',
                papers: [],
                assets: []
            });
        }
        const group = groups.get(key);
        group.papers.push(paper);
        group.assets.push(...getAssets(paper));
    });
    return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function courseMatches(group, search) {
    if (!search) return true;
    const haystack = [
        group.code,
        group.name,
        ...group.papers.flatMap(paper => [paper.topic, paper.examType, paper.trimester])
    ].join(' ').toLowerCase();
    return haystack.includes(search);
}

function assetLabel(asset) {
    if (asset.assetType === 'note') return 'Notes';
    return asset.assetType.charAt(0).toUpperCase() + asset.assetType.slice(1);
}

function renderResourceCards(paper, allowedTypes = ['question', 'solution', 'note']) {
    return getAssets(paper)
        .filter(asset => allowedTypes.includes(asset.assetType))
        .map(asset => `
            <article class="resource-card">
                <div class="chips">
                    <span class="pill ${asset.assetType === 'note' ? 'pill-teal' : asset.assetType === 'solution' ? 'pill-blue' : ''}">${escapeHtml(assetLabel(asset))}</span>
                    ${paper.examType ? `<span class="pill pill-blue">${escapeHtml(paper.examType)}</span>` : ''}
                    ${paper.trimester ? `<span class="pill pill-teal">${escapeHtml(paper.trimester)}</span>` : ''}
                </div>
                <h3>${escapeHtml(asset.topic || paper.topic || paper.title || 'Course Material')}</h3>
                <p class="muted">${escapeHtml(paper.courseCode)} - ${escapeHtml(paper.courseName || 'Course')} submitted by ${escapeHtml(paper.submitterName || getEmailHandle(getSubmitterEmail(paper)))}</p>
                <div class="resource-actions">
                    <a class="button-link" href="${escapeHtml(asset.pdfUrl)}" target="_blank" rel="noopener">Open File</a>
                    <span class="muted">${escapeHtml(asset.originalFilename || formatDate(paper.submittedAt))}</span>
                </div>
            </article>
        `);
}

function renderDashboard() {
    const courseCount = $('courseCount');
    const questionCount = $('questionCount');
    const solutionCount = $('solutionCount');
    const courseSearch = $('courseSearch');
    const dashboardCourses = $('dashboardCourses');
    const selectedCourseTitle = $('selectedCourseTitle');
    const selectedCourseMeta = $('selectedCourseMeta');
    const selectedResources = $('selectedResources');
    if (!dashboardCourses) return;

    const groups = getCourseGroups(approvedPapers.filter(paper => getQuestionAssets(paper).length > 0));
    const search = normalizeText(courseSearch?.value).toLowerCase();
    const filtered = groups.filter(group => courseMatches(group, search));

    if (courseCount) courseCount.textContent = String(groups.length);
    if (questionCount) questionCount.textContent = String(approvedPapers.reduce((total, paper) => total + getAssets(paper).filter(asset => asset.assetType === 'question').length, 0));
    if (solutionCount) solutionCount.textContent = String(approvedPapers.reduce((total, paper) => total + getAssets(paper).filter(asset => asset.assetType === 'solution').length, 0));

    if (!selectedCourseKey && filtered.length > 0) selectedCourseKey = filtered[0].key;

    if (filtered.length === 0) {
        dashboardCourses.innerHTML = '<div class="empty">No approved question courses match this search.</div>';
        if (selectedCourseTitle) selectedCourseTitle.textContent = 'Selected Course';
        if (selectedCourseMeta) selectedCourseMeta.textContent = 'No question course selected.';
        if (selectedResources) selectedResources.innerHTML = '<div class="empty">Approved questions and solutions will appear here.</div>';
        return;
    }

    dashboardCourses.innerHTML = filtered.slice(0, 8).map(group => {
        const questionTotal = group.papers.reduce((total, paper) => total + getQuestionAssets(paper).length, 0);
        return `
            <button class="course-button ${group.key === selectedCourseKey ? 'active' : ''}" type="button" data-course="${escapeHtml(group.key)}">
                <strong>${escapeHtml(group.code)} - ${escapeHtml(group.name)}</strong>
                <span class="muted">${questionTotal} question/solution file${questionTotal === 1 ? '' : 's'}</span>
            </button>
        `;
    }).join('');

    const group = groups.find(item => item.key === selectedCourseKey) || filtered[0];
    if (selectedCourseTitle) selectedCourseTitle.textContent = `${group.code} - ${group.name}`;
    if (selectedCourseMeta) selectedCourseMeta.textContent = 'Questions and solutions only';
    if (selectedResources) {
        selectedResources.innerHTML = group.papers.flatMap(paper => renderResourceCards(paper, ['question', 'solution'])).join('')
            || '<div class="empty">No questions or solutions are attached to this course yet.</div>';
    }
}

function renderAllCourses() {
    const allCourseSearch = $('allCourseSearch');
    const assetFilter = $('assetFilter');
    const allCoursesGrid = $('allCoursesGrid');
    if (!allCoursesGrid) return;

    const search = normalizeText(allCourseSearch?.value).toLowerCase();
    const filter = normalizeText(assetFilter?.value);
    const groups = getCourseGroups().filter(group => {
        const matchesSearch = courseMatches(group, search);
        const matchesType = !filter || group.assets.some(asset => asset.assetType === filter);
        return matchesSearch && matchesType;
    });

    if (groups.length === 0) {
        allCoursesGrid.innerHTML = '<div class="empty">No approved course materials match the current filters.</div>';
        return;
    }

    allCoursesGrid.innerHTML = groups.map(group => {
        const questionTypes = filter === 'question' || filter === 'solution'
            ? [filter]
            : ['question', 'solution'];
        const noteTypes = filter === 'note' || !filter ? ['note'] : [];
        const visibleQuestionCards = filter === 'note'
            ? []
            : group.papers.flatMap(paper => renderResourceCards(paper, questionTypes));
        const visibleNoteCards = noteTypes.length
            ? group.papers.flatMap(paper => renderResourceCards(paper, noteTypes))
            : [];
        return `
            <article class="course-card">
                <div>
                    <span class="pill">${escapeHtml(group.code)}</span>
                    <h3 style="margin-top: 10px;">${escapeHtml(group.name)}</h3>
                    <p class="muted">${group.assets.length} approved material${group.assets.length === 1 ? '' : 's'}</p>
                </div>
                <div class="chips">
                    <span class="pill">${group.assets.filter(asset => asset.assetType === 'question').length} questions</span>
                    <span class="pill pill-blue">${group.assets.filter(asset => asset.assetType === 'solution').length} solutions</span>
                    <span class="pill pill-teal">${group.assets.filter(asset => asset.assetType === 'note').length} notes</span>
                </div>
                <div class="course-section">
                    <h4>Questions & Solutions</h4>
                    ${visibleQuestionCards.slice(0, 4).join('') || '<div class="empty">No questions or solutions yet.</div>'}
                </div>
                <div class="course-section">
                    <h4>Notes</h4>
                    ${visibleNoteCards.slice(0, 4).join('') || '<div class="empty">No notes yet.</div>'}
                </div>
            </article>
        `;
    }).join('');
}

function renderCurrentPage() {
    if (page === 'dashboard') renderDashboard();
    if (page === 'courses') renderAllCourses();
}

function listenForApprovedPapers() {
    if (page !== 'dashboard' && page !== 'courses') return;
    const approvedQuery = query(collection(db, QUESTION_COLLECTION), where('status', '==', 'approved'));
    onSnapshot(approvedQuery, snapshot => {
        approvedPapers = snapshot.docs.map(paperFromDoc).sort(sortNewestFirst);
        renderCurrentPage();
    }, error => {
        console.error('Could not load approved materials:', error);
        const dashboardCourses = $('dashboardCourses');
        const allCoursesGrid = $('allCoursesGrid');
        if (dashboardCourses) dashboardCourses.innerHTML = '<div class="empty">Could not load approved questions. Check Firestore read rules.</div>';
        if (allCoursesGrid) allCoursesGrid.innerHTML = '<div class="empty">Could not load approved materials. Check Firestore read rules.</div>';
    });
}

async function requestUploadSignature(assetType, courseCode, topic) {
    const response = await fetch('/api/cloudinary/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assetType,
            courseCode,
            assetLabel: `${courseCode} ${assetType} - ${topic}`,
            resourceType: 'auto'
        })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Could not sign ${assetType} upload.`);
    return data;
}

async function uploadToCloudinary(assetType, file, courseCode, topic) {
    const signature = await requestUploadSignature(assetType, courseCode, topic);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', signature.apiKey);
    formData.append('signature', signature.signature);
    Object.entries(signature.uploadParams).forEach(([key, value]) => {
        formData.append(key, value);
    });

    const response = await fetch(signature.uploadUrl, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Could not upload ${assetType}.`);

    return {
        assetType,
        topic,
        pdfUrl: data.secure_url,
        cloudinaryPublicId: data.public_id,
        cloudinaryResourceType: data.resource_type || 'raw',
        cloudinaryAssetId: data.asset_id || '',
        bytes: data.bytes || file.size,
        originalFilename: data.original_filename || file.name
    };
}

async function saveSubmission(payload, materialAssets) {
    const validationResponse = await fetch('/api/questions/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, materialAssets })
    });
    const validationData = await validationResponse.json();
    if (!validationResponse.ok) throw new Error(validationData.error || 'Could not validate upload.');

    await addDoc(collection(db, QUESTION_COLLECTION), {
        ...validationData.submission,
        courseSearch: `${payload.courseCode} ${payload.courseName} ${payload.topic}`.toLowerCase(),
        materialGroup: materialAssets.some(asset => asset.assetType === 'note') ? 'notes' : 'questions',
        submittedAt: serverTimestamp()
    });
}

async function handleQuestionUpload(event) {
    event.preventDefault();
    const status = $('questionUploadStatus');
    const button = $('questionUploadButton');
    const payload = {
        submitterName: normalizeText($('questionSubmitterName').value),
        submitterEmail: normalizeText($('questionSubmitterEmail').value).toLowerCase(),
        courseCode: normalizeText($('questionCourseCode').value).replace(/\s+/g, ' ').toUpperCase(),
        courseName: normalizeText($('questionCourseName').value),
        topic: normalizeText($('questionTopic').value),
        trimester: normalizeText($('questionTrimester').value),
        examType: normalizeText($('questionExamType').value)
    };
    const questionFile = $('questionFile').files[0];
    const solutionFile = $('solutionFile').files[0];

    if (!isUniversityEmail(payload.submitterEmail)) {
        setStatus(status, 'Please use a UIU university email ending in .uiu.ac.bd.', 'error');
        return;
    }

    if (!questionFile) {
        setStatus(status, 'Attach a question file before submitting.', 'error');
        return;
    }

    try {
        button.disabled = true;
        setStatus(status, 'Uploading question and solution files to Cloudinary...', 'info');
        const materialAssets = [await uploadToCloudinary('question', questionFile, payload.courseCode, payload.topic)];
        if (solutionFile) {
            materialAssets.push(await uploadToCloudinary('solution', solutionFile, payload.courseCode, payload.topic));
        }
        setStatus(status, 'Saving question upload for admin approval...', 'info');
        await saveSubmission(payload, materialAssets);
        event.target.reset();
        setStatus(status, 'Question submitted. Admin approval email will be sent after review.', 'success');
    } catch (error) {
        console.error('Question upload failed:', error);
        setStatus(status, error.message || 'Question upload failed.', 'error');
    } finally {
        button.disabled = false;
    }
}

async function handleNotesUpload(event) {
    event.preventDefault();
    const status = $('notesUploadStatus');
    const button = $('notesUploadButton');
    const payload = {
        submitterName: normalizeText($('notesSubmitterName').value),
        submitterEmail: normalizeText($('notesSubmitterEmail').value).toLowerCase(),
        courseCode: normalizeText($('notesCourseCode').value).replace(/\s+/g, ' ').toUpperCase(),
        courseName: normalizeText($('notesCourseName').value),
        topic: normalizeText($('notesTopic').value),
        trimester: '',
        examType: 'Notes'
    };
    const notesFile = $('notesFile').files[0];

    if (!isUniversityEmail(payload.submitterEmail)) {
        setStatus(status, 'Please use a UIU university email ending in .uiu.ac.bd.', 'error');
        return;
    }

    if (!notesFile) {
        setStatus(status, 'Attach a notes file before submitting.', 'error');
        return;
    }

    try {
        button.disabled = true;
        setStatus(status, 'Uploading notes file to Cloudinary...', 'info');
        const materialAssets = [await uploadToCloudinary('note', notesFile, payload.courseCode, payload.topic)];
        setStatus(status, 'Saving notes upload for admin approval...', 'info');
        await saveSubmission(payload, materialAssets);
        event.target.reset();
        setStatus(status, 'Notes submitted. Admin approval email will be sent after review.', 'success');
    } catch (error) {
        console.error('Notes upload failed:', error);
        setStatus(status, error.message || 'Notes upload failed.', 'error');
    } finally {
        button.disabled = false;
    }
}

function bindDashboard() {
    const search = $('courseSearch');
    const searchButton = $('courseSearchButton');
    const list = $('dashboardCourses');
    if (search) search.addEventListener('input', renderDashboard);
    if (searchButton) searchButton.addEventListener('click', renderDashboard);
    if (list) {
        list.addEventListener('click', event => {
            const button = event.target.closest('[data-course]');
            if (!button) return;
            selectedCourseKey = button.getAttribute('data-course');
            renderDashboard();
        });
    }
}

function bindCourses() {
    const allCourseSearch = $('allCourseSearch');
    const assetFilter = $('assetFilter');
    if (allCourseSearch) allCourseSearch.addEventListener('input', renderAllCourses);
    if (assetFilter) assetFilter.addEventListener('change', renderAllCourses);
}

function bindUpload() {
    const questionForm = $('questionUploadForm');
    const notesForm = $('notesUploadForm');
    if (questionForm) questionForm.addEventListener('submit', handleQuestionUpload);
    if (notesForm) notesForm.addEventListener('submit', handleNotesUpload);
}

bindDashboard();
bindCourses();
bindUpload();
listenForApprovedPapers();
