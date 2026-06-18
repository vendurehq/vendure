class MyCustomReporter {
    onRunComplete(contexts, results) {
        const dbType = process.env.DB || 'sqljs';
        console.log(`Database engine: ${dbType}`);
    }
}

module.exports = MyCustomReporter;
