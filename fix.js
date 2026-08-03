const fs = require('fs');

function read(f) { return fs.readFileSync(f, 'utf8'); }
function write(f, d) { fs.writeFileSync(f, d); }

// patient-settings
let patset = read('components/patient-settings.tsx');
patset = patset.replace(/const handleSubmit = \(e: React\.FormEvent\) => \{[\s\S]*?onSave\(formData\);\n  \};/m, `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    
    if (user) {
      const data = await getUserData(user.uid);
      const history = data?.patientHistory || [];
      if (history.length > 0) {
        history[history.length - 1].weight = parseFloat(formData.weight);
      }
      
      await updateUserData(user.uid, {
        patientData: formData,
        patientHistory: history
      });
    } else {
      localStorage.setItem('mockPatientData', JSON.stringify(formData));
      const savedHistory = localStorage.getItem('mockPatientHistory');
      if (savedHistory) {
        try {
          const history = JSON.parse(savedHistory);
          if (history.length > 0) {
            history[history.length - 1].weight = parseFloat(formData.weight);
            localStorage.setItem('mockPatientHistory', JSON.stringify(history));
          }
        } catch (err) {}
      }
    }

    setSuccessMsg('Dados atualizados com sucesso!');
    onSave(formData);
  };`);
write('components/patient-settings.tsx', patset);
