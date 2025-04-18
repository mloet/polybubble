import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
    mode: 'development', // Automatically sets process.env.NODE_ENV
    devtool: 'inline-source-map',
    entry: {
        background: './src/background.js',
        popup: './src/popup.js',
        content: './src/content.js',
        offscreen: './src/offscreen.js'
    },
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: '[name].js',
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/popup.html',
            filename: 'popup.html',
            chunks: ['popup']
        }),
        new HtmlWebpackPlugin({
            template: './src/offscreen.html',
            filename: 'offscreen.html',
            chunks: ['offscreen']
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: "public",
                    to: "."
                },
                {
                    from: "src/popup.css",
                    to: "popup.css"
                },
                {
                    from: "src/content.css",
                    to: "content.css"
                },
                {
                    from: "models",
                    to: "models",
                    globOptions: {
                        ignore: ["**/*.txt", "**/.DS_Store"],
                    }
                },
                {
                    from: "node_modules/tesseract.js/dist/worker.min.js",
                    to: "local_libraries/tesseract/dist/worker.min.js"
                },
                {
                    from: "node_modules/tesseract.js-core/*",
                    to: "local_libraries/tesseract/tesseract.js-core/[name][ext]",
                },
            ],
        })
    ],
    performance: {
        hints: false,
        maxEntrypointSize: 10485760, // 10MB
        maxAssetSize: 10485760 // 10MB
    }
};

export default config;