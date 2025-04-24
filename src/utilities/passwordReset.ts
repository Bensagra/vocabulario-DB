import dotenv from 'dotenv';
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";





export const sendResetPasswordEmail = async (email: string, name: string, uuid: string) => {
  dotenv.config()
  console.log("email", email, name);
  const mailersend = new MailerSend({
    apiKey: process.env.MAILERSEND_KEY as string,
});

  const sentFrom = new Sender("bensagra@trial-k68zxl2nx7klj905.mlsender.net", "Mirrow verification code");

const recipients = [
  new Recipient(email, name)
];

const emailParams = new EmailParams()
  .setFrom(sentFrom)
  .setTo(recipients)
  .setSubject("This is a Subject")
  .setHtml(`
    <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      background-color: #f4f4f4;
      color: #333;
    }
    .email-container {
      max-width: 600px;
      margin: 20px auto;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .email-header {
      background-color: #007bff;
      color: #ffffff;
      text-align: center;
      padding: 20px;
    }
    .email-header h1 {
      margin: 0;
      font-size: 24px;
    }
    .email-body {
      padding: 20px;
      line-height: 1.6;
      text-align: center;
    }
    .email-body p {
      font-size: 16px;
      margin-bottom: 20px;
    }
    .reset-button {
      display: inline-block;
      padding: 10px 20px;
      background-color: #007bff;
      color: #ffffff;
      font-size: 18px;
      font-weight: bold;
      text-decoration: none;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      margin-top: 20px;
    }
    .reset-button:hover {
      background-color: #0056b3;
    }
    .email-footer {
      background-color: #f4f4f4;
      text-align: center;
      padding: 10px;
      font-size: 14px;
      color: #777;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Password Reset</h1>
    </div>
    <div class="email-body">
      <p>Hello <strong>${name}</strong>,</p>
      <p>We received a request to reset your password. Please click the button below to set a new password:</p>
      <a class="reset-button" href="https://pruebas-lac.vercel.app/data.html?uuid=${uuid}">Reset Password</a>
      <p>If you did not request this email, you can safely ignore it. Your current password will remain unchanged.</p>
    </div>
    <div class="email-footer">
      <p>© 2024 Mirrow. All rights reserved.</p>
    </div>
  </div>
</body>
</html>

    `)
    
  .setText("This is the text content");

try {
  let data = await mailersend.email.send(emailParams);
return(data);

} catch (error) {
  return error;
}
}