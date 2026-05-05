import os
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

# Folder to save downloads
download_dir = os.path.abspath("landsat_images")
os.makedirs(download_dir, exist_ok=True)

# Chrome options for auto download
options = webdriver.ChromeOptions()
prefs = {
    "download.default_directory": download_dir,
    "download.prompt_for_download": False,
    "download.directory_upgrade": True
}
options.add_experimental_option("prefs", prefs)

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

# Open NASA page
driver.get("https://science.nasa.gov/specials/your-name-in-landsat/")
time.sleep(5)

def generate_and_download(text):
    try:
        # Input field
        input_box = driver.find_element(By.TAG_NAME, "input")
        input_box.clear()
        input_box.send_keys(text)
        input_box.send_keys(Keys.RETURN)

        time.sleep(5)  # wait for image render

        # Click download button
        download_btn = driver.find_element(By.ID, "downloadBtn")
        download_btn.click()

        print(f"Downloaded for: {text}")
        time.sleep(3)

    except Exception as e:
        print(f"Error for {text}: {e}")

# 🔁Space-separated captions
captions_input = input("Enter captions (space-separated): ")
captions = captions_input.split()

for cap in captions:
    generate_and_download(cap)

driver.quit()