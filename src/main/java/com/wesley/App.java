package com.wesley;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.logging.FileHandler;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.logging.SimpleFormatter;

import org.openqa.selenium.By;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

public class App {
    private static final Logger logger = Logger.getLogger(App.class.getName());

    public static void main(String[] args) {
        try {
            FileHandler fileHandler = new FileHandler("app.log");
            fileHandler.setFormatter(new SimpleFormatter());
            logger.addHandler(fileHandler);

            List<String> phoneNumbers = FileReader.readPhoneNumbers("telefones.txt");
            logger.log(Level.INFO, "Total de números de telefone lidos: " + phoneNumbers.size());

            String message = FileReader.readMessage("mensagem.txt");
            logger.log(Level.INFO, "Mensagem lida: " + message);

            WebDriver driver = DriverInitializer.initializeEdgeDriver("C:\\dev\\edgedriver\\msedgedriver.exe");
            driver.manage().window().minimize();
            WebDriverWait wait = new WebDriverWait(driver, 30);
            // Aguardar 2 segundos implicitamente
            // driver.manage().timeouts().implicitlyWait(2, TimeUnit.SECONDS);
            logger.log(Level.INFO, "####################################");
            for (String phoneNumber : phoneNumbers) {
                String url = "https://api.whatsapp.com/send?phone=" + phoneNumber + "&text=" + message;
                logger.log(Level.INFO, "Navegando para: " + url);
                driver.get(url);

                try {
                    WebElement element = wait.until(ExpectedConditions.presenceOfElementLocated(By.className("_9vcv")));
                    logger.log(Level.INFO, "Classe '_9vcv' encontrada. Iniciando conversa...");

                    WebElement startChatButton = driver.findElement(By.xpath("//a[contains(@class,'_3b3-3')]"));
                    startChatButton.click();

                    logger.log(Level.INFO, "Botão 'iniciar conversa' clicado.");
                    // Aguardar 2 segundos antes de processar o próximo número

                } catch (NoSuchElementException e) {
                    logger.log(Level.SEVERE,
                            "Classe '_9vcv' não encontrada. Verifique sua conexão ou o HTML da página.");
                }

                logger.log(Level.INFO, "Navegação concluída para: " + url);
            }

            driver.quit();
            logger.log(Level.INFO, "Execução finalizada.");

        } catch (IOException e) {
            logger.log(Level.SEVERE, "Erro durante a execução: " + e.getMessage());
        }
    }
}
