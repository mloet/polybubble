


<div align="center">
  <img src="https://github.com/user-attachments/assets/e6e4a4b7-a750-4fe7-99ef-a0a8dc29046a" alt="polyheader">
</div>

An automatic comic translator extension, using Tesseract and a DETR model to identify and translate text. Under development, so may not work perfectly. When sufficiently polished, I may add it to the chrome store.

This is a tool I made for myself to translate comics/manga in the browser. While there are a number of desktop based applications and a few paid browser extensions, I wanted to put togther a tool that could be used convieniently without paying for hosting a backend or LLM API calls. Currently the extension requires setting up either a Google or DeepL API key, which both allow 500,000 characters of translation a month (which should probably be more than enough). I am considering experimenting with lightweight translation models that could be packaged with the extension, but as of right now DeepL or Google are the only options. 

The extension uses a detection-transformer model to identify speech bubbles and free text in order to anchor the OCR service. It is currently set up to use Tesseract.js (totally free, configured to run locally in the browser) or Google Cloud Vision OCR (1000 pages per month free, 1.50 per 1000 images after). Tesseract is less powerful than the Google API, so it may struggle on free text with noisy backgrounds or odd fonts, but for pages with clean text or mostly speech bubbles it works nearly as well as google.

The extension currently requires providing a DeepL or Google API key, but cannot and will not steal it (you can look at the code). However, PLEASE be careful on where you are pasting your keys. The DeepL free API will not bill you for exceeding 500,000 characters in a month, but the Google key does not have hard limits set by default, so I highly reccomend taking the time to set limits for only the required APIs before use to be safe.

In order to package and run it for yourself:

1. Clone the repository.
2. Download the model from https://huggingface.co/mloet/comic_text_bubble_detector/tree/main.
3. Navigate to the directory.
4. Place the model in the models/ folder.
5. Install the necessary dependencies by running:
   npm install
7. Build the project by running:
   npm run build
9. Add the extension to your browser. To do this, go to chrome://extensions/, enable developer mode (top right), and click "Load unpacked". Select the build directory from the dialog which appears and click "Select Folder". Choose build as the folder.

