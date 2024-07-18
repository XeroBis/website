
const translations = {
    en: {
        about_me_accroche: "The only data scientist you'll ever need.",
        about_me_phrase: "I'm Alan, a passionate developer with a strong interest in Data Science. I enjoy working on challenging projects and constantly improving my skills.",
        send_mail: "Contact me !",
        my_projects: "My projects",
        cv_title: "My Resume",
        download_cv: "click here to download pdf",
    },
    fr: {
        about_me_accroche: "Le seul data scientist dont vous aurez besoin.",
        about_me_phrase: "Je suis Alan, un développeur passionné avec un fort intérêt pour la Data Science. J'aime travailler sur des projets stimulants et améliorer constamment mes compétences.",
        send_mail: "Contactez-moi !",
        my_projects: "Mes projets",
        cv_title: "Mon CV",
        download_cv: "cliquez ici pour télécharger le pdf",
    }
};

function setLanguage(language) {
    document.getElementById('about_me_accroche').textContent = translations[language].about_me_accroche;
    document.getElementById('about_me_phrase').textContent = translations[language].about_me_phrase;
    document.getElementById('send_mail').textContent = translations[language].send_mail;
    document.getElementById('my_projects').textContent = translations[language].my_projects;
    document.getElementById('cv_title').textContent = translations[language].cv_title;
    document.getElementById('a_cv').textContent = translations[language].download_cv;
    document.getElementById('a_cv').href = 'files/bignon_alan_cv_'+language+'.pdf';

}
