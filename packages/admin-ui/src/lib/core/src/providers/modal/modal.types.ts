/**
 * @description
 * Any component intended to be used with the ModalService.fromComponent() method must implement
 * this interface.
 *
 * @docsCategory services
 * @docsPage ModalService
 */
export interface Dialog<R = any> {
    /**
     * @description
     * Function to be invoked in order to close the dialog when the action is complete.
     * The Observable returned from the .fromComponent() method will emit the value passed
     * to this method and then complete.
     */
    resolveWith: (result?: R) => void;
}

export interface DialogButtonConfig<T> {
    label: string;
    type: 'secondary' | 'primary' | 'danger';
    translationVars?: Record<string, string | number>;
    returnValue?: T;
}

/**
 * @description
 * Configures a generic modal dialog.
 *
 * @docsCategory services
 * @docsPage ModalService
 */
export interface DialogConfig<T> {
    title: string;
    body?: string;
    translationVars?: { [key: string]: string | number };
    buttons: Array<DialogButtonConfig<T>>;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * @description
 * Options to configure the behaviour of the modal.
 *
 * @docsCategory services
 * @docsPage ModalService
 */
export interface ModalOptions<T> {
    /**
     * @description
     * Sets the width of the dialog
     */
    size?: 'sm' | 'md' | 'lg' | 'xl';
    /**
     * @description
     * Sets the vertical alignment of the dialog
     */
    verticalAlign?: 'top' | 'center' | 'bottom';
    /**
     * @description
     * When true, the "x" icon is shown
     * and clicking it or the mask will close the dialog
     */
    closable?: boolean;
    /**
     * @description
     * Values to be passed directly to the component being instantiated inside the dialog.
     */
    locals?: Partial<T>;
}
