
const translations = {
    en: {
        about_me_accroche: "The only expert you'll ever need.",
        about_me_phrase: "I'm Alan, a passionate developer with a strong interest in technology and data. I enjoy working on challenging projects and constantly improving my skills across multiple domains.",
        my_projects: "My projects",
        cv_title: "My Resume",
        download_cv: "click here to download pdf",
        project_website_title:"This Website",
        project_website_content:"It was created using purerly HTML, CSS and javascript." + 
            "It serves as a platform to display my abilities in Python developpement and what kind of project I have been doing."+
            "By sharing what I have done, I hope I can attract potential employers or collaborators.",
        project_irc_chat_title:"IRC Chat",
        project_irc_chat_content:"This is a multi-threaded IRC chat application implemented in Python. Two implementations are available: <br/>"+
            "- multi server <br/>"+
            "- single server <br/>"+
            "For each implementation there is a client-side code that allows users to connect to the server, "+
            "join channels, and send messages and there is a server-side code capable of handling multiple clients and servers.",
        project_finance_title:"Financial Sentiment Analysis",
        project_finance_content:"This project offers a comprehensive toolkit for analyzing sentiments within financial text data."+
            "Leveraging state-of-the-art natural language processing (NLP) techniques, machine learning algorithms and LMs fine tuning, "+
            "our project provides insights into the sentiment dynamics of financial phrases.",
        project_blockchain_title:"Blockchain Experiment",
        project_blockchain_content: "Basic implementation of a blockchain in Python with miner and wallet functionalities."+
            "This project was created to understand how blockchain works and how it can be and has been implemented."+
            "Smart contracts in Tezos are also programmed.",
        project_language_title:"Native Language Detection",
        project_language_content:"This project is a native language detection tool. It is able to detect the native language of person that wrote a given text in english."+
            "The project was coded in Python and uses NLP and Machine Learning algorithm.",
        project_life_title:"Game Of Life",
        project_life_content:"This project is an implementation of Conway's Game of Life, a cellular automaton devised by the British mathematician John Horton Conway. "+
                    "The game is a zero-player game, meaning that its evolution is determined by its initial state, requiring no further input. "+
                    "The project was coded in OCaml and Python. "+
                    "Both version are very different and have different features.",
        project_note_title:"Android Notes Taking App",
        project_note_content:"This project is a simple notes app for Android. It was created to learn Kotlin and how to create an Android app. "+
                    "We decided to try to only use chatgpt to generate the code as a challenge. In the end we stil had to write some code (~15%) but it was a fun experience. "+
                    "As a result of this experience we can say that chatgpt is not yet ready to replace human developpers. "+
                    "The ~15% of code we had to write was mostly to fix the code generated by chatgpt, which was not always correct. "+
                    "The big problem was that chatgpt was not able to understand the context of the code.",
        project_autograd_title:"Basic Autograd implementation",
        project_autograd_content:"Basic implementation of autograd in Python. This project was created to understand how autograd and neural network basic functionnality works. I followed the tutorial of Andrej Karpathy. "+
            "His implementation : <a href='https://github.com/karpathy/micrograd' target=”_blank”><b>micrograd</b></a>",
    },
    fr: {
        about_me_accroche: "Le seul expert dont vous aurez besoin.",
        about_me_phrase: "Je suis Alan, un développeur passionné avec un grand intérêt pour la technologie et les données. J'aime travailler sur des projets stimulants et améliorer constamment mes compétences dans divers domaines.",
        my_projects: "Mes projets",
        cv_title: "Mon CV",
        download_cv: "cliquez ici pour télécharger le pdf",
        project_website_title:"Ce Site",
        project_website_content:"Il a été créé en utilisant du HTML, du CSS et du javascript." + 
            "Il sert de plate-forme pour montrer mes capacités en développement Python et le type de projet que j'ai réalisé." +
            "En partageant ce que j'ai fait, j'espère pouvoir attirer des employeurs ou des collaborateurs potentiels",
        project_irc_chat_title:"Chat IRC",
        project_irc_chat_content:"Il s'agit d'une applicaiton de chat IRC, implémenté en Python. Deux implémentations sont disponibles : <br/>"+
            "- serveurs multiples  <br/>"+
            "- serveur unique <br/>"+
            "Pour chaque implémentation, il existe un code côté client qui permet aux utilisateurs de se connecter au serveur, "+
            "de rejoindre des canaux et d'envoyer des messages et il existe un code côté serveur capable de gérer plusieurs clients et serveurs.",
        project_finance_title:"Analyse de sentiment financier",
        project_finance_content:"Ce projet propose une boîte à outils pour analyser les sentiments au sein de données textuelles financières. "+
            "En exploitant des techniques de NLP, de machine learning ainsi que du fine tuning de language models, "+
            "notre projet fournit des informations sur la dynamique des sentiments des phrases financières.",
        project_blockchain_title:"Expérience Blockchain",
        project_blockchain_content: "Implémentation basique d'une blockchain en python avec des fonctionnalités de mineur et de wallet."+
            "Ce projet a été créé pour comprendre comment fonctionne la blockchain et comment elle peut être et a été mise en œuvre."+
            "Des Smart contracts en Tezos ont aussi été programmés.",
        project_language_title:"Détection de langue maternelle",
        project_language_content:"Ce projet est un outil de détection de langue maternelle. "+
            "Il est capable de détecter la langue maternelle d'une personne ayant écrit un texte en anglais."+
            "Le projet a été codé en Python et utilise des algorithmes de PNL et d'apprentissage automatique.",
        project_life_title:"Jeu de la vie",
        project_life_content:"Ce projet est une implémentation du jeu de la vie de Conway, un automate cellulaire conçu par le mathématicien britannique John Horton Conway. "+
            "Le jeu est un jeu à zéro joueur, ce qui signifie que son évolution est déterminée par son état initial, ne nécessitant aucune autre saisie. "+
            "Le projet a été codé en OCaml et Python. "+
            "Les deux versions sont très différentes et ont des fonctionnalités différentes.",
        project_note_title:"Application Android de prise de notes ",
        project_note_content:"Ce projet est une simple application de notes pour Android. Il a été créé pour apprendre Kotlin et les étapes de la création d'une application Android. "+
                        "Nous avons décidé d'essayer d'utiliser uniquement chatgpt pour générer le code comme défi. Au final, nous avons quand même dû écrire du code (~15 %) mais ce fut une expérience amusante. "+
                        "À la suite de cette expérience, nous pouvons dire que chatgpt n'est pas encore prêt à remplacer les développeurs humains. "+
                        "Les ~15% de code que nous avons dû écrire étaient principalement destinés à corriger le code généré par chatgpt, qui n'était pas toujours correct. "+
                        "Le gros problème était que chatgpt n'était pas capable de comprendre le contexte du code.",
        project_autograd_title:"Implémentation basique d'un autograd",
        project_autograd_content:"Implémentation basique d'un autograd en Python. Ce projet a été créé pour comprendre comment fonctionnent les fonctionnalités de base de l'autograd et des réseaux neuronaux. J'ai suivi le tutoriel d'Andrej Karpathy. "+
                "Son implémentation : <a href='https://github.com/karpathy/micrograd' target=”_blank”><b>micrograd</b></a>",
    }
};

function setLanguage(language) {
    for (elm in translations[language]){
        console.log(elm)
        document.getElementById(elm).innerHTML = translations[language][elm];
        if (elm == 'download_cv'){
            document.getElementById(String(elm)).href = 'files/bignon_alan_cv_'+language+'.pdf';
        }
    }

    // document.getElementById('about_me_accroche').textContent = translations[language].about_me_accroche;
    // document.getElementById('about_me_phrase').textContent = translations[language].about_me_phrase;
    // document.getElementById('my_projects').textContent = translations[language].my_projects;
    // document.getElementById('cv_title').textContent = translations[language].cv_title;
    // document.getElementById('a_cv').textContent = translations[language].download_cv;
    // document.getElementById('a_cv').href = 'files/bignon_alan_cv_'+language+'.pdf';
    // document.getElementById('project_website_title').textContent = translations[language].project_website_title;
    // document.getElementById('project_website_content').textContent = translations[language].project_website_content;
}
